"""Tests for the deterministic offline event parser (``app.quick_parse``).

Covers the ``/add`` / ``/quick`` fast path: defaults (today, all-day, medium
priority, ``1d`` Telegram reminder, one-time), date forms (month names, ISO,
numeric, weekdays-always-next, relative days, ``in N days/weeks``), time
forms (``HH:MM`` with/without ``at``, ``6pm``, ``at 18``), reminder offsets,
priorities, recurrence words and title cleanup.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.quick_parse import parse_quick_add

# Tuesday 2026-09-22 09:00 UTC; Europe/Berlin is UTC+2 (11:00 local).
NOW = datetime(2026, 9, 22, 9, 0, tzinfo=UTC)
TZ = "Europe/Berlin"


def test_silo_example_from_request() -> None:
    """The season-of-Silo example parses with defaults (1d Telegram reminder)."""
    result = parse_quick_add("A new seasion of Silo arrives on June 12 2027", NOW, TZ)
    draft = result.draft
    assert draft.title == "A new seasion of Silo arrives"
    assert draft.start_at == "2027-06-12T00:00:00+02:00"
    assert draft.all_day is True
    assert draft.tz == TZ
    assert draft.priority == "medium"
    assert draft.reminder_offsets == ["1d"]
    assert draft.channels == ["telegram"]
    assert draft.rrule is None
    assert draft.type == "one_time"
    assert result.has_explicit_date is True
    assert result.has_explicit_time is False


def test_friday_example_from_request() -> None:
    """The pick-up-daughter example resolves Friday-next + 18:00 + 1h."""
    result = parse_quick_add(
        "Pick up daughter from school on Friday at 18:00 1h", NOW, TZ
    )
    draft = result.draft
    assert draft.title == "Pick up daughter from school"
    # 2026-09-22 is a Tuesday, so the next Friday is 2026-09-25.
    assert draft.start_at == "2026-09-25T18:00:00+02:00"
    assert draft.all_day is False
    assert draft.priority == "medium"
    assert draft.reminder_offsets == ["1h"]
    assert result.has_explicit_date is True
    assert result.has_explicit_time is True


def test_defaults_for_bare_title() -> None:
    """No tokens at all: today, all-day, medium, 1d, one-time."""
    result = parse_quick_add("Buy milk", NOW, TZ)
    draft = result.draft
    assert draft.title == "Buy milk"
    assert draft.start_at == "2026-09-22T00:00:00+02:00"
    assert draft.all_day is True
    assert draft.priority == "medium"
    assert draft.reminder_offsets == ["1d"]
    assert draft.channels == ["telegram"]
    assert draft.rrule is None
    assert result.has_explicit_date is False
    assert result.has_explicit_time is False


def test_weekday_without_on() -> None:
    """A bare weekday (no 'on') is still a date — always the next one."""
    result = parse_quick_add("Gym Friday 18:00", NOW, TZ)
    assert result.draft.title == "Gym"
    assert result.draft.start_at == "2026-09-25T18:00:00+02:00"
    assert result.has_explicit_date is True


def test_weekday_on_same_day_means_next_week() -> None:
    """Saying 'Tuesday' on a Tuesday means 7 days out, not today."""
    result = parse_quick_add("Standup Tuesday", NOW, TZ)
    assert result.draft.start_at == "2026-09-29T00:00:00+02:00"


def test_next_prefix_weekday() -> None:
    """'next Friday' behaves like 'Friday' (always next)."""
    result = parse_quick_add("Party next Friday", NOW, TZ)
    assert result.draft.start_at == "2026-09-25T00:00:00+02:00"


def test_relative_dates() -> None:
    """today / tomorrow / day after tomorrow resolve against now."""
    assert (
        parse_quick_add("Do it today", NOW, TZ).draft.start_at
        == "2026-09-22T00:00:00+02:00"
    )
    assert (
        parse_quick_add("Dentist tomorrow at 9am", NOW, TZ).draft.start_at
        == "2026-09-23T09:00:00+02:00"
    )
    assert (
        parse_quick_add("Trip day after tomorrow", NOW, TZ).draft.start_at
        == "2026-09-24T00:00:00+02:00"
    )


def test_in_n_days_and_weeks() -> None:
    """'in 3 days' is a date (not a '3d' reminder)."""
    result = parse_quick_add("Call mom in 3 days at 18:00", NOW, TZ)
    assert result.draft.title == "Call mom"
    assert result.draft.start_at == "2026-09-25T18:00:00+02:00"
    assert result.draft.reminder_offsets == ["1d"]
    assert (
        parse_quick_add("Review in 2 weeks", NOW, TZ).draft.start_at
        == "2026-10-06T00:00:00+02:00"
    )


def test_month_name_forms() -> None:
    """Month-first, day-first and year-less forms all work."""
    assert (
        parse_quick_add("Show June 12 2027", NOW, TZ).draft.start_at
        == "2027-06-12T00:00:00+02:00"
    )
    assert (
        parse_quick_add("Show 12 June 2027", NOW, TZ).draft.start_at
        == "2027-06-12T00:00:00+02:00"
    )
    # Year-less past date rolls to next year (June 12 already passed in Sept).
    assert (
        parse_quick_add("Birthday June 12", NOW, TZ).draft.start_at
        == "2027-06-12T00:00:00+02:00"
    )
    # Year-less future date stays this year.
    assert (
        parse_quick_add("Party October 3", NOW, TZ).draft.start_at
        == "2026-10-03T00:00:00+02:00"
    )


def test_iso_and_numeric_dates() -> None:
    """ISO and DD.MM.YYYY dates parse; the time half is not eaten."""
    result = parse_quick_add("Meeting 2026-09-25 14:30", NOW, TZ)
    assert result.draft.title == "Meeting"
    assert result.draft.start_at == "2026-09-25T14:30:00+02:00"
    result = parse_quick_add("Lunch 12.10.2026 13:00", NOW, TZ)
    assert result.draft.title == "Lunch"
    assert result.draft.start_at == "2026-10-12T13:00:00+02:00"


def test_time_forms() -> None:
    """HH:MM (with/without 'at'), 12h clock and 'at H' all parse."""
    assert (
        parse_quick_add("Call 18:00 tomorrow", NOW, TZ).draft.start_at
        == "2026-09-23T18:00:00+02:00"
    )
    assert (
        parse_quick_add("Call at 18:00 tomorrow", NOW, TZ).draft.start_at
        == "2026-09-23T18:00:00+02:00"
    )
    assert (
        parse_quick_add("Call 6pm tomorrow", NOW, TZ).draft.start_at
        == "2026-09-23T18:00:00+02:00"
    )
    assert (
        parse_quick_add("Call at 6:30 pm tomorrow", NOW, TZ).draft.start_at
        == "2026-09-23T18:30:00+02:00"
    )
    assert (
        parse_quick_add("Dentist tomorrow at 9", NOW, TZ).draft.start_at
        == "2026-09-23T09:00:00+02:00"
    )
    # A bare "18h" (no 'at') is a reminder per the "1h/2d/15m" rule …
    bare = parse_quick_add("Call tomorrow 18h", NOW, TZ)
    assert bare.draft.reminder_offsets == ["18h"]
    assert bare.has_explicit_time is False
    # … while "at 18h" is unambiguously a time.
    assert (
        parse_quick_add("Call tomorrow at 18h", NOW, TZ).draft.start_at
        == "2026-09-23T18:00:00+02:00"
    )


def test_reminder_offsets() -> None:
    """Compact and verbose reminder forms normalize; '1w' becomes '7d'."""
    assert parse_quick_add("Dentist tomorrow 15m", NOW, TZ).draft.reminder_offsets == [
        "15m"
    ]
    assert parse_quick_add(
        "Dentist tomorrow 15 minutes", NOW, TZ
    ).draft.reminder_offsets == ["15m"]
    assert parse_quick_add(
        "Dentist tomorrow 1 hour", NOW, TZ
    ).draft.reminder_offsets == ["1h"]
    assert parse_quick_add(
        "Dentist tomorrow 2 days", NOW, TZ
    ).draft.reminder_offsets == ["2d"]
    assert parse_quick_add("Dentist tomorrow 1w", NOW, TZ).draft.reminder_offsets == [
        "7d"
    ]
    assert parse_quick_add(
        "Dentist tomorrow 30m 2h", NOW, TZ
    ).draft.reminder_offsets == ["30m", "2h"]


def test_priorities_and_aliases() -> None:
    """low/medium/critical plus high→critical and normal→medium."""
    assert parse_quick_add("X tomorrow low", NOW, TZ).draft.priority == "low"
    assert parse_quick_add("X tomorrow critical", NOW, TZ).draft.priority == "critical"
    assert parse_quick_add("X tomorrow high", NOW, TZ).draft.priority == "critical"
    assert parse_quick_add("X tomorrow urgent", NOW, TZ).draft.priority == "critical"
    assert parse_quick_add("X tomorrow normal", NOW, TZ).draft.priority == "medium"
    # Last mention wins.
    assert (
        parse_quick_add("X tomorrow low critical", NOW, TZ).draft.priority == "critical"
    )


def test_recurrence_words() -> None:
    """Recurrence words map to RRULEs and flip the type to recurrent."""
    cases = {
        "daily": "FREQ=DAILY",
        "weekly": "FREQ=WEEKLY",
        "monthly": "FREQ=MONTHLY",
        "quarterly": "FREQ=MONTHLY;INTERVAL=3",
        "yearly": "FREQ=YEARLY",
        "every day": "FREQ=DAILY",
        "every week": "FREQ=WEEKLY",
    }
    for word, rrule in cases.items():
        result = parse_quick_add(f"Gym {word} Monday at 7pm", NOW, TZ)
        assert result.draft.rrule == rrule, word
        assert result.draft.type == "recurrent", word
        assert word not in result.draft.title.lower()


def test_title_cleanup() -> None:
    """Extracted tokens (with prepositions) leave a clean title."""
    assert (
        parse_quick_add(
            "Pick up daughter from school on Friday at 18:00 1h low weekly",
            NOW,
            TZ,
        ).draft.title
        == "Pick up daughter from school"
    )
    assert parse_quick_add("Dentist tomorrow", NOW, TZ).draft.title == "Dentist"


def test_case_insensitivity() -> None:
    """Keywords match regardless of case."""
    result = parse_quick_add("DENTIST TOMORROW AT 9AM CRITICAL DAILY", NOW, TZ)
    assert result.draft.title == "DENTIST"
    assert result.draft.start_at == "2026-09-23T09:00:00+02:00"
    assert result.draft.priority == "critical"
    assert result.draft.rrule == "FREQ=DAILY"


def test_start_at_is_valid_for_event_create() -> None:
    """The produced draft converts to an EventCreate (schema-valid offsets)."""
    from app.schemas import EventCreate
    from app.telegram_inbound import draft_to_event_create

    for text in (
        "A new seasion of Silo arrives on June 12 2027",
        "Pick up daughter from school on Friday at 18:00 1h",
        "Gym weekly Monday at 7pm 1w high",
        "Buy milk",
    ):
        result = parse_quick_add(text, NOW, TZ)
        payload = draft_to_event_create(result.draft, text, default_tz=TZ)
        assert isinstance(payload, EventCreate)
        assert payload.reminder_offsets == list(result.draft.reminder_offsets)
