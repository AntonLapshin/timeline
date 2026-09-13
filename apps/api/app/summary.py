"""Monthly summary counts for timeline events (issue #15).

Pure business logic: given a collection of event-like objects (exposing the
same attributes the recurrence module reads, plus ``priority``) and a target
month, count how many concrete occurrences fall within that month, grouped by
priority. Recurrence expansion reuses ``app.recurrence.next_occurrences`` so
recurrent events contribute one count per occurrence in the month.

No routes, no framework coupling, no I/O — trivially testable.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from .recurrence import Occurrence, next_occurrences

#: Priorities in canonical order (shared schema).
_PRIORITIES = ("critical", "medium", "low")

#: How many occurrences to request per event when scanning a month. A single
#: calendar month holds at most 31 daily occurrences (744 hourly), so this is
#: comfortably more than enough while staying well under the recurrence
#: module's safety bound.
_MONTH_OCCURRENCES = 1000


class _SummaryEvent(Protocol):
    """The subset of an event the summary reads (duck-typed).

    Includes the recurrence attributes consumed by ``app.recurrence`` plus
    ``priority`` and ``tz`` used for grouping and month interpretation.
    """

    priority: Any
    tz: str
    rrule: str | None
    start_at: datetime
    end_at: datetime | None
    all_day: bool


def _month_bounds(year: int, month: int, zone: ZoneInfo) -> tuple[datetime, datetime]:
    """Local start of the requested month and of the following month (aware)."""
    start_local = datetime(year, month, 1, tzinfo=zone)
    if month == 12:
        end_local = datetime(year + 1, 1, 1, tzinfo=zone)
    else:
        end_local = datetime(year, month + 1, 1, tzinfo=zone)
    return start_local, end_local


def occurrences_in_month(
    event: _SummaryEvent, year: int, month: int
) -> list[Occurrence]:
    """All concrete occurrences of ``event`` that fall in the given month.

    The month is interpreted in the event's own timezone (``event.tz``), which
    is where its occurrences are anchored (all-day events at local midnight).
    Occurrences are returned in ascending order.
    """
    zone = ZoneInfo(event.tz)
    start_local, end_local = _month_bounds(year, month, zone)
    occurrences = next_occurrences(
        event, _MONTH_OCCURRENCES, after=start_local.astimezone(UTC)
    )
    return [o for o in occurrences if o.start.astimezone(zone) < end_local]


@dataclass(frozen=True)
class MonthSummary:
    """Counts of event occurrences in a month, grouped by priority."""

    month: str
    total: int
    by_priority: dict[str, int]


def summarize_month(
    events: Sequence[_SummaryEvent], year: int, month: int
) -> MonthSummary:
    """Count occurrences of ``events`` falling in ``year``/``month`` by priority.

    ``events`` must expose ``priority`` (a ``EventPriority`` enum or its string
    value) and the recurrence attributes (``rrule``, ``start_at``, ``end_at``,
    ``tz``, ``all_day``). Returns a ``MonthSummary`` keyed by priority.
    """
    counts: dict[str, int] = {p: 0 for p in _PRIORITIES}
    total = 0
    for event in events:
        for _occ in occurrences_in_month(event, year, month):
            priority = str(event.priority)
            if priority not in counts:
                counts[priority] = 0
            counts[priority] += 1
            total += 1
    return MonthSummary(
        month=f"{year:04d}-{month:02d}",
        total=total,
        by_priority=counts,
    )
