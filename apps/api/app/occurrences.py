"""Per-occurrence month expansion for timeline events (issue #27).

Pure business logic: given a collection of event-like objects (exposing the
same recurrence attributes ``app.summary``/``app.recurrence`` read) and a
target month, expand each active event's concrete occurrences that fall in
that month (interpreted in each event's timezone) into one entry per
occurrence. Each entry carries the fields the calendar grid needs to place a
recurrent event without porting the recurrence engine to TypeScript, plus a
``next_occurrence`` (the next occurrence at/after the month) for the day
drawer.

No routes, no framework coupling, no I/O — trivially testable.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from .recurrence import next_occurrences
from .summary import occurrences_in_month

#: How many occurrences to expand past the month when computing the next
#: occurrence. A single occurrence is enough for the day drawer.
_NEXT_OCCURRENCE = 1


class _OccurrenceEvent(Protocol):
    """The subset of an event the occurrence expansion reads (duck-typed)."""

    id: int
    title: str
    priority: Any
    tags: list[str]
    rrule: str | None
    start_at: datetime
    end_at: datetime | None
    all_day: bool
    tz: str


@dataclass(frozen=True)
class EventOccurrence:
    """A single concrete occurrence of an event within a month.

    Mirrors the fields the calendar grid needs to place a (possibly recurrent)
    event on the grid: ``event_id``/``title``/``priority``/``tag`` for display,
    ``rrule`` for the recurrence badge, and ``start_at``/``all_day``/``tz`` for
    placement. ``next_occurrence`` is the next occurrence at/after the month
    (for the day drawer).
    """

    event_id: int
    title: str
    priority: str
    tag: str | None
    rrule: str | None
    start_at: datetime
    all_day: bool
    tz: str
    next_occurrence: datetime | None


def _first_tag(tags: list[str]) -> str | None:
    """The event's first tag (used for the tag badge), or None."""
    return tags[0] if tags else None


def _next_after_month(
    event: _OccurrenceEvent, year: int, month: int
) -> datetime | None:
    """The next occurrence at/after the end of the requested month, if any.

    Used for the day drawer's "next occurrence" hint. Returns None only when
    the event has no occurrence at or after the month (e.g. it ended earlier).
    """
    zone = ZoneInfo(event.tz)
    if month == 12:
        after_local = datetime(year + 1, 1, 1, tzinfo=zone)
    else:
        after_local = datetime(year, month + 1, 1, tzinfo=zone)
    occurrences = next_occurrences(
        event, _NEXT_OCCURRENCE, after=after_local.astimezone(UTC)
    )
    return occurrences[0].start if occurrences else None


def occurrences_for_month(
    events: Sequence[_OccurrenceEvent], year: int, month: int
) -> list[EventOccurrence]:
    """Expand ``events`` into one entry per occurrence falling in the month.

    The month is interpreted in each event's own timezone (``event.tz``).
    One-time events contribute a single occurrence; recurrent events contribute
    one entry per occurrence in the month (reusing ``occurrences_in_month``).
    Entries are returned in ascending order of start time.
    """
    result: list[EventOccurrence] = []
    for event in events:
        for occ in occurrences_in_month(event, year, month):
            result.append(
                EventOccurrence(
                    event_id=event.id,
                    title=event.title,
                    priority=str(event.priority),
                    tag=_first_tag(event.tags),
                    rrule=event.rrule,
                    start_at=occ.start,
                    all_day=bool(event.all_day),
                    tz=event.tz,
                    next_occurrence=_next_after_month(event, year, month),
                )
            )
    result.sort(key=lambda o: o.start_at)
    return result
