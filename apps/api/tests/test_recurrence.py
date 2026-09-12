"""Tests for RFC 5545 recurrence expansion (issue #14).

Covers the pure ``app.recurrence`` module: daily/weekly/monthly/quarterly/
yearly/custom rules, timezone + DST handling, all-day (date-only, DST-stable)
events, one-time events, no-end-date recurrences, the ``after`` filter,
occurrence ids/ends, caching, and error cases.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.enums import EventPriority, EventSource, EventStatus, EventType
from app.models import Event
from app.recurrence import (
    Occurrence,
    RecurrenceError,
    clear_cache,
    next_occurrences,
)


def _event(**overrides: object) -> SimpleNamespace:
    """A minimal recurrence input, mirroring the Event model's attributes."""
    values: dict[str, object] = {
        "rrule": "FREQ=DAILY",
        "start_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        "tz": "UTC",
        "all_day": False,
        "end_at": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.fixture(autouse=True)
def _no_cache() -> None:
    """Keep the module cache empty between tests."""
    clear_cache()
    yield
    clear_cache()


def _starts(occurrences: list[Occurrence]) -> list[datetime]:
    return [o.start for o in occurrences]


# --- rule types -------------------------------------------------------------


def test_daily_recurrence() -> None:
    event = _event(rrule="FREQ=DAILY", start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    occs = next_occurrences(event, 3)
    assert _starts(occs) == [
        datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        datetime(2026, 1, 2, 10, 0, tzinfo=UTC),
        datetime(2026, 1, 3, 10, 0, tzinfo=UTC),
    ]


def test_weekly_recurrence() -> None:
    event = _event(
        rrule="FREQ=WEEKLY;BYDAY=MO",
        start_at=datetime(2026, 1, 5, 9, 0, tzinfo=UTC),  # a Monday
    )
    occs = next_occurrences(event, 3)
    assert [o.start.weekday() for o in occs] == [0, 0, 0]
    assert occs[0].start == datetime(2026, 1, 5, 9, 0, tzinfo=UTC)
    assert occs[1].start == datetime(2026, 1, 12, 9, 0, tzinfo=UTC)


def test_monthly_recurrence() -> None:
    event = _event(
        rrule="FREQ=MONTHLY;BYMONTHDAY=15",
        start_at=datetime(2026, 1, 15, 12, 0, tzinfo=UTC),
    )
    occs = next_occurrences(event, 3)
    assert [o.start.day for o in occs] == [15, 15, 15]
    assert occs[0].start.month == 1
    assert occs[1].start.month == 2
    assert occs[2].start.month == 3


def test_quarterly_recurrence_drifts_to_last_day() -> None:
    """A quarterly rule (every 3 months) from Jan 31 keeps the 31st where the
    month has one and clamps to the last day otherwise (quarterly drift)."""
    event = _event(
        rrule="FREQ=MONTHLY;INTERVAL=3",
        start_at=datetime(2026, 1, 31, 10, 0, tzinfo=UTC),
    )
    occs = next_occurrences(event, 4)
    assert [o.start.date().isoformat() for o in occs] == [
        "2026-01-31",
        "2026-07-31",
        "2026-10-31",
        "2027-01-31",
    ]


def test_yearly_recurrence() -> None:
    event = _event(
        rrule="FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14",
        start_at=datetime(2026, 3, 14, 8, 30, tzinfo=UTC),
    )
    occs = next_occurrences(event, 3)
    assert [o.start.year for o in occs] == [2026, 2027, 2028]
    assert [o.start.month for o in occs] == [3, 3, 3]


def test_leap_day_recurrence() -> None:
    """A Feb 29 yearly rule only fires on leap years."""
    event = _event(
        rrule="FREQ=YEARLY",
        start_at=datetime(2024, 2, 29, 10, 0, tzinfo=UTC),
    )
    occs = next_occurrences(event, 3)
    assert [o.start.date().isoformat() for o in occs] == [
        "2024-02-29",
        "2028-02-29",
        "2032-02-29",
    ]


def test_custom_rule_multiple_weekdays() -> None:
    """A custom rule can combine weekdays (Mon/Wed/Fri)."""
    event = _event(
        rrule="FREQ=WEEKLY;BYDAY=MO,WE,FR",
        start_at=datetime(2026, 1, 5, 9, 0, tzinfo=UTC),  # Monday
    )
    occs = next_occurrences(event, 6)
    dates = [o.start.date().isoformat() for o in occs]
    assert dates == [
        "2026-01-05",  # Mon
        "2026-01-07",  # Wed
        "2026-01-09",  # Fri
        "2026-01-12",  # Mon
        "2026-01-14",  # Wed
        "2026-01-16",  # Fri
    ]


# --- timezone / DST ---------------------------------------------------------


def test_event_tz_vs_stored_utc() -> None:
    """An event stored in UTC expands in its local timezone and returns UTC."""
    # 10:00 local in Europe/Berlin (UTC+1 in January) == 09:00 UTC.
    event = _event(
        rrule="FREQ=DAILY",
        start_at=datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
        tz="Europe/Berlin",
    )
    occs = next_occurrences(event, 2)
    assert occs[0].start == datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
    # Local wall-clock stays 10:00 across DST (UTC shifts by an hour).
    assert occs[0].start.astimezone(ZoneInfo("Europe/Berlin")).hour == 10


def test_dst_transition_keeps_local_wall_time() -> None:
    """A timed event across a spring-forward keeps its local wall-clock time;
    the UTC instant shifts by the DST offset."""
    # America/New_York springs forward 2026-03-08 (02:00 -> 03:00).
    # 09:30 local on 2026-03-07 (EST, UTC-5) == 14:30 UTC.
    event = _event(
        rrule="FREQ=DAILY",
        start_at=datetime(2026, 3, 7, 14, 30, tzinfo=UTC),
        tz="America/New_York",
    )
    occs = next_occurrences(event, 4)
    ny = ZoneInfo("America/New_York")
    local_times = [o.start.astimezone(ny) for o in occs]
    # Every occurrence is 09:30 local, even across the DST boundary.
    assert [t.hour for t in local_times] == [9, 9, 9, 9]
    assert [t.minute for t in local_times] == [30, 30, 30, 30]
    # The UTC instant shifts by one hour between Mar 7 (EST) and Mar 8 (EDT).
    assert occs[0].start == datetime(2026, 3, 7, 14, 30, tzinfo=UTC)
    assert occs[1].start == datetime(2026, 3, 8, 13, 30, tzinfo=UTC)
    assert occs[2].start == datetime(2026, 3, 9, 13, 30, tzinfo=UTC)


def test_all_day_event_is_date_only_and_dst_stable() -> None:
    """All-day events anchor at the local calendar date (midnight) and never
    drift across DST."""
    # start_at is the local midnight of 2026-03-07 in New York (EST, UTC-5)
    # serialized to UTC, so the intended local date is 2026-03-07.
    event = _event(
        rrule="FREQ=DAILY",
        start_at=datetime(2026, 3, 7, 5, 0, tzinfo=UTC),
        tz="America/New_York",
        all_day=True,
    )
    occs = next_occurrences(event, 4)
    ny = ZoneInfo("America/New_York")
    # Each occurrence is midnight on successive local dates, across DST.
    assert [o.start.astimezone(ny).date().isoformat() for o in occs] == [
        "2026-03-07",
        "2026-03-08",
        "2026-03-09",
        "2026-03-10",
    ]
    assert [o.start.astimezone(ny).hour for o in occs] == [0, 0, 0, 0]
    # occurrence ids are date-only.
    assert [o.occurrence_id for o in occs] == [
        "2026-03-07",
        "2026-03-08",
        "2026-03-09",
        "2026-03-10",
    ]


def test_all_day_monthly_keeps_date_across_dst() -> None:
    """A monthly all-day event stays on the same date regardless of DST."""
    # Midnight 2026-03-08 in New York (EST) serialized to UTC.
    event = _event(
        rrule="FREQ=MONTHLY;BYMONTHDAY=8",
        start_at=datetime(2026, 3, 8, 5, 0, tzinfo=UTC),
        tz="America/New_York",
        all_day=True,
    )
    occs = next_occurrences(event, 3)
    ny = ZoneInfo("America/New_York")
    assert [o.start.astimezone(ny).date().isoformat() for o in occs] == [
        "2026-03-08",
        "2026-04-08",
        "2026-05-08",
    ]


# --- one-time events --------------------------------------------------------


def test_one_time_event_returns_single_occurrence() -> None:
    event = _event(rrule=None, start_at=datetime(2026, 6, 1, 9, 0, tzinfo=UTC))
    occs = next_occurrences(event, 5)
    assert len(occs) == 1
    assert occs[0].start == datetime(2026, 6, 1, 9, 0, tzinfo=UTC)


def test_series_next_june_one_time_event() -> None:
    """A one-time event scheduled for 'next June' is a single occurrence."""
    event = _event(
        rrule=None,
        start_at=datetime(2027, 6, 5, 18, 0, tzinfo=UTC),
        tz="Europe/Berlin",
    )
    occs = next_occurrences(event, 3)
    assert len(occs) == 1
    assert occs[0].start == datetime(2027, 6, 5, 18, 0, tzinfo=UTC)
    berlin = ZoneInfo("Europe/Berlin")
    assert occs[0].start.astimezone(berlin).date().isoformat() == "2027-06-05"


def test_one_time_all_day_event() -> None:
    # Midnight 2026-06-01 in New York (EDT, UTC-4) serialized to UTC.
    event = _event(
        rrule=None,
        start_at=datetime(2026, 6, 1, 4, 0, tzinfo=UTC),
        tz="America/New_York",
        all_day=True,
    )
    occs = next_occurrences(event, 3)
    assert len(occs) == 1
    assert occs[0].occurrence_id == "2026-06-01"


# --- no end date / after filter --------------------------------------------


def test_no_end_date_recurrence() -> None:
    """An unbounded recurrence (no UNTIL/COUNT) keeps producing occurrences."""
    event = _event(rrule="FREQ=WEEKLY;BYDAY=FR")
    occs = next_occurrences(event, 10)
    assert len(occs) == 10
    assert [o.start.weekday() for o in occs] == [4] * 10


def test_after_filter_returns_only_future_occurrences() -> None:
    event = _event(rrule="FREQ=DAILY", start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    after = datetime(2026, 1, 3, 0, 0, tzinfo=UTC)
    occs = next_occurrences(event, 3, after=after)
    assert _starts(occs) == [
        datetime(2026, 1, 3, 10, 0, tzinfo=UTC),
        datetime(2026, 1, 4, 10, 0, tzinfo=UTC),
        datetime(2026, 1, 5, 10, 0, tzinfo=UTC),
    ]


def test_after_filter_excludes_naive_after_by_assuming_utc() -> None:
    event = _event(rrule="FREQ=DAILY", start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    occs = next_occurrences(event, 2, after=datetime(2026, 1, 2, 0, 0))
    assert occs[0].start == datetime(2026, 1, 2, 10, 0, tzinfo=UTC)


# --- occurrence metadata ----------------------------------------------------


def test_occurrence_end_from_event_duration() -> None:
    event = _event(
        rrule="FREQ=DAILY",
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        end_at=datetime(2026, 1, 1, 11, 30, tzinfo=UTC),
    )
    occs = next_occurrences(event, 2)
    assert occs[0].end == datetime(2026, 1, 1, 11, 30, tzinfo=UTC)
    assert occs[1].end == datetime(2026, 1, 2, 11, 30, tzinfo=UTC)


def test_occurrence_end_none_without_event_end() -> None:
    event = _event(rrule="FREQ=DAILY", start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    occs = next_occurrences(event, 1)
    assert occs[0].end is None


def test_all_day_occurrence_ends_next_day() -> None:
    event = _event(
        rrule="FREQ=DAILY",
        start_at=datetime(2026, 1, 1, 0, 0, tzinfo=UTC),
        all_day=True,
        tz="UTC",
    )
    occs = next_occurrences(event, 1)
    assert occs[0].end == datetime(2026, 1, 2, 0, 0, tzinfo=UTC)


def test_all_day_occurrence_end_uses_event_duration() -> None:
    """An all-day event with an explicit end uses the stored duration."""
    event = _event(
        rrule="FREQ=DAILY",
        start_at=datetime(2026, 1, 1, 0, 0, tzinfo=UTC),
        end_at=datetime(2026, 1, 2, 0, 0, tzinfo=UTC),
        all_day=True,
        tz="UTC",
    )
    occs = next_occurrences(event, 2)
    assert occs[0].end == datetime(2026, 1, 2, 0, 0, tzinfo=UTC)
    assert occs[1].end == datetime(2026, 1, 3, 0, 0, tzinfo=UTC)


def test_occurrence_id_is_iso_utc_for_timed_events() -> None:
    event = _event(rrule="FREQ=DAILY", start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    occs = next_occurrences(event, 1)
    assert occs[0].occurrence_id == "2026-01-01T10:00:00+00:00"


# --- caching ----------------------------------------------------------------


def test_repeated_reads_are_cached() -> None:
    """Repeated reads with identical inputs return the same cached objects
    without recomputation (same object identity)."""
    event = _event(rrule="FREQ=DAILY")
    first = next_occurrences(event, 3)
    second = next_occurrences(event, 3)
    assert first == second
    # lru_cache returns the exact same tuple of Occurrence objects.
    assert first[0] is second[0]


def test_clear_cache_drops_cached_results() -> None:
    event = _event(rrule="FREQ=DAILY")
    first = next_occurrences(event, 3)
    clear_cache()
    second = next_occurrences(event, 3)
    assert first == second
    assert first[0] is not second[0]


# --- errors -----------------------------------------------------------------


def test_negative_n_raises() -> None:
    with pytest.raises(RecurrenceError):
        next_occurrences(_event(), -1)


def test_zero_n_returns_empty() -> None:
    assert next_occurrences(_event(), 0) == []


def test_invalid_rrule_raises() -> None:
    with pytest.raises(RecurrenceError):
        next_occurrences(_event(rrule="NOT_A_RULE"), 3)


def test_unknown_timezone_raises() -> None:
    with pytest.raises(RecurrenceError):
        next_occurrences(_event(tz="Not/AZone"), 3)


# --- ORM integration --------------------------------------------------------


def test_works_with_orm_event_model() -> None:
    """The pure module works directly with the ORM ``Event`` model."""
    event = Event(
        title="Standup",
        type=EventType.RECURRENT,
        start_at=datetime(2026, 1, 5, 9, 0, tzinfo=UTC),
        tz="UTC",
        rrule="FREQ=WEEKLY;BYDAY=MO",
        priority=EventPriority.MEDIUM,
        source=EventSource.WEB,
        status=EventStatus.ACTIVE,
    )
    occs = next_occurrences(event, 3)
    assert len(occs) == 3
    assert occs[0].start == datetime(2026, 1, 5, 9, 0, tzinfo=UTC)
    assert occs[1].start == datetime(2026, 1, 12, 9, 0, tzinfo=UTC)


def test_duration_is_timedelta_aware() -> None:
    event = _event(
        rrule="FREQ=DAILY",
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        end_at=datetime(2026, 1, 1, 10, 45, tzinfo=UTC),
    )
    occs = next_occurrences(event, 1)
    assert occs[0].end - occs[0].start == timedelta(minutes=45)
