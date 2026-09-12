"""RFC 5545 recurrence expansion for timeline events (issue #14).

Pure business logic: no routes, no framework coupling, no I/O. Given an
event's recurrence inputs (``rrule``, ``start_at``, ``tz``, ``all_day``,
``end_at``) it expands the next ``n`` concrete occurrences using
``dateutil.rrule``, handling timezones (DST-aware) and all-day events
correctly, and caches results so repeated reads don't recompute.

The module is deliberately decoupled from the ORM: ``next_occurrences``
accepts any object exposing the documented attributes (an ``Event`` model
works), so it stays pure and trivially testable.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from typing import Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil import rrule as rr

#: Safety bound on how many generated occurrences we examine per call. A
#: recurrence with no end date (no UNTIL/COUNT) is infinite; this keeps a
#: single call from running away while still comfortably covering any n.
_MAX_OCCURRENCES = 100_000

#: A one-time event (no rrule) is expressed as a single daily occurrence.
_SINGLE_RRULE = "FREQ=DAILY;COUNT=1"


class RecurrenceError(ValueError):
    """Raised when an event's recurrence inputs are invalid (bad tz/rrule)."""


@dataclass(frozen=True)
class Occurrence:
    """A single concrete occurrence of an event.

    ``start`` (and ``end``, when present) are timezone-aware UTC datetimes.
    ``occurrence_id`` is a stable, human-readable identifier for the
    occurrence (used e.g. as the ``DeliveryLog.occurrence_id``).
    """

    start: datetime
    end: datetime | None
    occurrence_id: str


def _zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except ZoneInfoNotFoundError as exc:  # pragma: no cover - trivial
        raise RecurrenceError(f"unknown timezone: {tz!r}") from exc


def _as_utc(dt: datetime) -> datetime:
    """Normalize a (possibly naive) datetime to an aware UTC datetime."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


class _RecurrenceSource(Protocol):
    """The subset of an event the recurrence logic reads (duck-typed)."""

    rrule: str | None
    start_at: datetime
    end_at: datetime | None
    tz: str
    all_day: bool


def _local_start(start_utc: datetime, all_day: bool, zone: ZoneInfo) -> datetime | date:
    """The recurrence ``dtstart`` in the event's local timezone.

    All-day events anchor at the local calendar date (date-only) so they never
    drift across DST; timed events keep their local wall-clock time.
    """
    local = start_utc.astimezone(zone)
    if all_day:
        return local.date()
    return local


def _start_utc(start_utc: datetime, all_day: bool, zone: ZoneInfo) -> datetime:
    """The UTC instant used as the default ``after`` lower bound.

    For all-day events this is the start date at local midnight converted to
    UTC, so the first occurrence (same local date) is always included no matter
    the zone offset. For timed events it is simply the start instant.
    """
    if all_day:
        local = start_utc.astimezone(zone).date()
        return datetime(local.year, local.month, local.day, tzinfo=zone).astimezone(UTC)
    return start_utc


def _build_rule(
    rrule_str: str, start_utc: datetime, all_day: bool, zone: ZoneInfo
) -> rr.rrule | rr.rruleset:
    """Build and validate a ``dateutil`` rrule from an RFC 5545 string."""
    dtstart = _local_start(start_utc, all_day, zone)
    try:
        return rr.rrulestr(rrule_str, dtstart=dtstart)
    except (ValueError, TypeError) as exc:
        raise RecurrenceError(f"invalid rrule {rrule_str!r}: {exc}") from exc


def _duration(
    start_utc: datetime, end_utc: datetime | None, all_day: bool
) -> timedelta | None:
    """Per-occurrence duration, or None when the event has no end time.

    All-day events without an explicit end span the whole day.
    """
    if end_utc is None:
        return timedelta(days=1) if all_day else None
    return end_utc - start_utc


def _occurrence_utc(occ: datetime | date, all_day: bool, zone: ZoneInfo) -> datetime:
    """Convert a generated occurrence to an aware UTC datetime.

    All-day occurrences are anchored at local midnight of their calendar date
    (date-only, DST-stable); timed occurrences carry their local wall-clock
    time through the zone conversion.
    """
    if all_day:
        # dateutil yields midnight datetimes even for date-only dtstart.
        return datetime(occ.year, occ.month, occ.day, tzinfo=zone).astimezone(UTC)
    assert isinstance(occ, datetime)
    return _as_utc(occ)


def _make_occurrence(
    occ_utc: datetime, end_utc: datetime | None, all_day: bool, zone: ZoneInfo
) -> Occurrence:
    """Assemble an ``Occurrence`` with a stable id from its UTC start."""
    if all_day:
        occurrence_id = occ_utc.astimezone(zone).date().isoformat()
    else:
        occurrence_id = occ_utc.isoformat()
    return Occurrence(start=occ_utc, end=end_utc, occurrence_id=occurrence_id)


@lru_cache(maxsize=256)
def _cached_next(
    rrule_str: str,
    start_iso: str,
    tz: str,
    all_day: bool,
    end_iso: str,
    n: int,
    after_iso: str,
) -> tuple[Occurrence, ...]:
    """Expand the next ``n`` occurrences, cached on its immutable inputs."""
    zone = _zone(tz)
    start_utc = _as_utc(datetime.fromisoformat(start_iso))
    end_utc = _as_utc(datetime.fromisoformat(end_iso)) if end_iso else None
    after_utc = _as_utc(datetime.fromisoformat(after_iso)) if after_iso else None
    if after_utc is None:
        after_utc = _start_utc(start_utc, all_day, zone)

    rule = _build_rule(rrule_str, start_utc, all_day, zone)
    duration = _duration(start_utc, end_utc, all_day)

    result: list[Occurrence] = []
    examined = 0
    for occ in rule:
        examined += 1
        occ_utc = _occurrence_utc(occ, all_day, zone)
        if occ_utc < after_utc:
            continue
        end_utc = occ_utc + duration if duration is not None else None
        result.append(_make_occurrence(occ_utc, end_utc, all_day, zone))
        if len(result) >= n:
            break
        if examined >= _MAX_OCCURRENCES:
            break
    return tuple(result)


def next_occurrences(
    event: _RecurrenceSource,
    n: int,
    after: datetime | None = None,
) -> list[Occurrence]:
    """Return the next ``n`` concrete occurrences of ``event``, materialized on read.

    ``event`` must expose ``rrule`` (RFC 5545 string or None for one-time),
    ``start_at`` (aware/naive UTC datetime), ``tz`` (IANA name), ``all_day``
    (bool) and ``end_at`` (UTC datetime or None). Occurrences are returned in
    ascending order with UTC timestamps and stable ``occurrence_id`` strings.

    When ``after`` is given, only occurrences with ``start >= after`` (UTC) are
    returned; otherwise the first ``n`` occurrences from the event start are
    returned. Results are cached by (rrule, start, tz, all-day, end, n, after)
    so repeated reads don't recompute.
    """
    if n < 0:
        raise RecurrenceError("n must be >= 0")
    if n == 0:
        return []

    rrule_str = event.rrule or _SINGLE_RRULE
    start_iso = _as_utc(event.start_at).isoformat()
    end_at = event.end_at
    end_iso = _as_utc(end_at).isoformat() if end_at is not None else ""
    after_iso = _as_utc(after).isoformat() if after is not None else ""
    all_day = bool(event.all_day)
    tz = event.tz

    return list(_cached_next(rrule_str, start_iso, tz, all_day, end_iso, n, after_iso))


def clear_cache() -> None:
    """Drop all cached expansions (used by tests and after event edits)."""
    _cached_next.cache_clear()
