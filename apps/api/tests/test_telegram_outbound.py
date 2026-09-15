"""Tests for the Telegram outbound reminder sender (issue #55, M4-T2).

Covers the acceptance criteria:

- **Priority card**: ``format_reminder_card`` renders emoji, title, date/time,
  countdown and notes for a delivered reminder.
- **Single allowed user**: ``is_allowed_user`` enforces the allowlist (fail
  closed when either side is unset).
- **Low priority suppressed**: ``should_push`` never pushes low-priority events.
- **Ack / Snooze / Delete buttons**: the callback codec
  (``callback_data`` / ``parse_callback_data``), the reply markup, and the
  per-action state transitions (``ack_delivery``, ``snooze_delivery``,
  ``delete_delivery``) plus the dispatch ``handle_callback``.

Plus the pure helpers (``priority_emoji``, ``countdown_text``) and the impure
wiring (``make_telegram_job_func``, ``_parse_chat_id``, ``build_telegram_application``).
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.enums import EventChannel, EventPriority, EventSource, EventStatus, EventType
from app.models import DeliveryLog, Event
from app.scheduler import build_scheduler, dedupe_key
from app.telegram_outbound import (
    _parse_chat_id,
    _run_send,
    ack_delivery,
    build_reply_markup,
    build_telegram_application,
    callback_data,
    countdown_text,
    delete_delivery,
    format_reminder_card,
    handle_callback,
    is_allowed_user,
    make_telegram_job_func,
    parse_callback_data,
    priority_emoji,
    should_push,
    snooze_allowed_for_event,
    snooze_delivery,
)

# --- fixtures ---------------------------------------------------------------


@pytest.fixture()
def session_factory(tmp_path: Path) -> sessionmaker[Session]:
    """A session factory over an isolated temp DB."""
    settings = Settings(data_dir=tmp_path, db_name="telegram.db")
    engine = create_engine_from_settings(settings)
    models.Base.metadata.create_all(engine)
    return make_session_factory(engine)


def _event(**overrides: object) -> Event:
    """Build a minimal valid Event with reminder defaults."""
    values: dict[str, object] = {
        "title": "Team standup",
        "description": "Bring the sprint board",
        "type": EventType.ONE_TIME,
        "start_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        "tz": "UTC",
        "priority": EventPriority.MEDIUM,
        "source": EventSource.WEB,
        "status": EventStatus.ACTIVE,
        "reminder_offsets": ["1h"],
    }
    values.update(overrides)
    return Event(**values)


def _now() -> datetime:
    return datetime(2026, 1, 1, 8, 30, tzinfo=UTC)


# --- pure helpers ------------------------------------------------------------


def test_priority_emoji() -> None:
    """Each priority maps to an emoji; unknown falls back to the medium bell."""
    assert priority_emoji(EventPriority.CRITICAL) == "🔥"
    assert priority_emoji(EventPriority.MEDIUM) == "⏰"
    assert priority_emoji(EventPriority.LOW) == "💤"
    assert priority_emoji("bogus") == "⏰"  # type: ignore[arg-type]


def test_should_push_suppresses_low() -> None:
    """Low priority is never proactively pushed."""
    assert should_push(EventPriority.CRITICAL) is True
    assert should_push(EventPriority.MEDIUM) is True
    assert should_push(EventPriority.LOW) is False


def test_is_allowed_user_allowlist() -> None:
    """Only the configured single user is allowed; unset fails closed."""
    assert is_allowed_user("123", "123") is True
    assert is_allowed_user("123", "456") is False
    # Unset on either side -> nothing allowed.
    assert is_allowed_user(None, "123") is False
    assert is_allowed_user("123", None) is False
    assert is_allowed_user(None, None) is False
    # Numeric-string comparison.
    assert is_allowed_user(123, "123") is True  # type: ignore[arg-type]


def test_countdown_text() -> None:
    """Countdown strings are human-readable."""
    now = datetime(2026, 1, 1, 8, 30, tzinfo=UTC)
    assert countdown_text(now + timedelta(hours=1, minutes=30), now) == "in 1h 30m"
    assert countdown_text(now + timedelta(minutes=45), now) == "in 45m"
    assert countdown_text(now + timedelta(seconds=30), now) == "now"
    assert countdown_text(now - timedelta(minutes=5), now) == "now"


def test_format_reminder_card_contains_all_fields() -> None:
    """The card includes emoji, title, date/time, countdown and notes."""
    event = _event(
        title="Dentist",
        description="Root canal",
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        priority=EventPriority.CRITICAL,
    )
    card = format_reminder_card(event, "occ-1", "1h", now=_now())
    assert "🔥" in card
    assert "Dentist" in card
    assert "01/01/2026" in card or "Jan 01, 2026" in card
    assert "in 1h 30m" in card
    assert "Root canal" in card
    assert "occ-1" in card
    assert "1h" in card


def test_format_reminder_card_omits_notes_when_empty() -> None:
    """An event with no description renders no notes line."""
    event = _event(description="")
    card = format_reminder_card(event, "occ-1", "30m", now=_now())
    assert "📝" not in card


# --- callback codec ----------------------------------------------------------


def test_callback_data_roundtrip() -> None:
    """Callback data round-trips through parse_callback_data."""
    data = callback_data("ack", 7, "2026-01-01T10:00:00+00:00", "1h")
    assert parse_callback_data(data) == ("ack", 7, "2026-01-01T10:00:00+00:00", "1h")
    # Different actions/ids produce distinct data.
    assert callback_data("ack", 7, "a", "1h") != callback_data("snooze", 7, "a", "1h")


def test_parse_callback_data_rejects_malformed() -> None:
    """Malformed callback data returns None (never crashes the handler)."""
    assert parse_callback_data("") is None
    assert parse_callback_data("ack|7|a") is None  # too few parts
    assert parse_callback_data("ack|x|a|1h") is None  # non-numeric id
    assert parse_callback_data("ack|7||1h") is None  # empty occurrence
    assert parse_callback_data("ack|7|a|") is None  # empty offset


def test_build_reply_markup_has_three_buttons() -> None:
    """The card carries Ack / Snooze / Delete inline buttons."""
    markup = build_reply_markup(7, "occ", "1h")
    row = markup["inline_keyboard"][0]
    assert len(row) == 3
    assert [b["text"] for b in row] == ["✅ Ack", "😴 Snooze 1d", "🗑 Delete"]
    assert row[0]["callback_data"].startswith("ack|7|")
    assert row[1]["callback_data"].startswith("snooze|7|")
    assert row[2]["callback_data"].startswith("delete|7|")


def test_build_reply_markup_omits_snooze_when_disallowed() -> None:
    """When snooze_allowed is False the Snooze button is omitted (issue #62)."""
    markup = build_reply_markup(7, "occ", "1h", snooze_allowed=False)
    row = markup["inline_keyboard"][0]
    assert [b["text"] for b in row] == ["✅ Ack", "🗑 Delete"]
    assert all("snooze" not in b["callback_data"] for b in row)


# --- action state transitions -------------------------------------------------


def _add_sent_log(session: Session, event_id: int, occurrence: str = "occ") -> None:
    session.add(
        DeliveryLog(
            event_id=event_id,
            occurrence_id=occurrence,
            offset="1h",
            status="sent",
        )
    )


def test_ack_delivery_marks_acked(session_factory: sessionmaker[Session]) -> None:
    """Acknowledge flips the sent DeliveryLog to acked."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        _add_sent_log(session, event.id)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        ok = ack_delivery(session, event_id, "occ", "1h")
        assert ok is True
        session.commit()

    with session_factory() as session:
        log = session.query(DeliveryLog).one()
        assert log.status == "acked"


def test_ack_delivery_noop_when_missing(session_factory: sessionmaker[Session]) -> None:
    """Ack on a reminder with no sent log returns False."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        assert ack_delivery(session, event_id, "occ", "1h") is False


def test_snooze_delivery_returns_rescheduled(
    session_factory: sessionmaker[Session],
) -> None:
    """Snooze marks the log and returns a +1 day PlannedReminder."""
    now = _now()
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        _add_sent_log(session, event.id)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        planned = snooze_delivery(session, event_id, "occ", "1h", now=now)
        assert planned is not None
        assert planned.event_id == event_id
        assert planned.offset == "1h"
        assert planned.run_at == now + timedelta(days=1)
        assert planned.occurrence_id != "occ"  # distinct dedupe key
        session.commit()

    with session_factory() as session:
        log = session.query(DeliveryLog).one()
        assert log.status == "snoozed"


def test_snooze_delivery_noop_when_missing(
    session_factory: sessionmaker[Session],
) -> None:
    """Snooze on a reminder with no sent log returns None."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        assert snooze_delivery(session, event_id, "occ", "1h", now=_now()) is None


def test_delete_delivery_marks_deleted(session_factory: sessionmaker[Session]) -> None:
    """Delete marks the sent DeliveryLog as deleted."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        _add_sent_log(session, event.id)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        ok = delete_delivery(session, event_id, "occ", "1h")
        assert ok is True
        session.commit()

    with session_factory() as session:
        assert session.query(DeliveryLog).one().status == "deleted"


def test_delete_delivery_noop_when_missing(
    session_factory: sessionmaker[Session],
) -> None:
    """Delete on a reminder with no sent log returns False."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        assert delete_delivery(session, event_id, "occ", "1h") is False


# --- handle_callback dispatch -------------------------------------------------


def test_handle_callback_ack(session_factory: sessionmaker[Session]) -> None:
    """The ack callback answers and marks the delivery acked."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        _add_sent_log(session, event.id)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        msg = handle_callback(
            data=callback_data("ack", event_id, "occ", "1h"),
            session=session,
            scheduler=None,
            job_func=lambda *a, **k: None,
        )
        assert msg == "Acknowledged ✓"
        session.commit()
    with session_factory() as session:
        assert session.query(DeliveryLog).one().status == "acked"


def test_handle_callback_delete(session_factory: sessionmaker[Session]) -> None:
    """The delete callback answers and marks the delivery deleted."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        _add_sent_log(session, event.id)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        msg = handle_callback(
            data=callback_data("delete", event_id, "occ", "1h"),
            session=session,
            scheduler=None,
            job_func=lambda *a, **k: None,
        )
        assert msg == "Reminder deleted 🗑"
        session.commit()
    with session_factory() as session:
        assert session.query(DeliveryLog).one().status == "deleted"


def test_handle_callback_snooze_schedules(
    session_factory: sessionmaker[Session], tmp_path: Path
) -> None:
    """The snooze callback re-schedules the reminder one day later."""
    settings = Settings(data_dir=tmp_path, db_name="telegram.db")
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        _add_sent_log(session, event.id)
        session.commit()
        event_id = event.id

    scheduler = build_scheduler(settings)
    try:
        now = _now()
        with session_factory() as session:
            planned = snooze_delivery(session, event_id, "occ", "1h", now=now)
            assert planned is not None
            msg = handle_callback(
                data=callback_data("snooze", event_id, "occ", "1h"),
                session=session,
                scheduler=scheduler,
                job_func=lambda *a, **k: None,
                now=now,
            )
            assert msg == "Snoozed for 1 day 😴"
            session.commit()

        # A job for the snoozed occurrence was scheduled.
        key = dedupe_key(event_id, planned.occurrence_id, "1h")
        assert scheduler.get_job(key) is not None
    finally:
        with contextlib.suppress(Exception):
            scheduler.shutdown(wait=False)


def test_handle_callback_invalid(session_factory: sessionmaker[Session]) -> None:
    """Malformed or unknown callback data is answered with a safe message."""
    with session_factory() as session:
        assert (
            handle_callback(
                data="garbage",
                session=session,
                scheduler=None,
                job_func=lambda *a, **k: None,
            )
            == "Invalid action"
        )
        assert (
            handle_callback(
                data=callback_data("explode", 1, "occ", "1h"),
                session=session,
                scheduler=None,
                job_func=lambda *a, **k: None,
            )
            == "Unknown action"
        )


def test_handle_callback_snooze_noop_when_missing(
    session_factory: sessionmaker[Session],
) -> None:
    """Snooze with no sent log answers with a safe no-op message."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        msg = handle_callback(
            data=callback_data("snooze", event_id, "occ", "1h"),
            session=session,
            scheduler=None,
            job_func=lambda *a, **k: None,
        )
        assert msg == "Nothing to snooze"


def test_handle_callback_ack_noop_when_missing(
    session_factory: sessionmaker[Session],
) -> None:
    """Ack with no sent log answers with a safe no-op message."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        msg = handle_callback(
            data=callback_data("ack", event_id, "occ", "1h"),
            session=session,
            scheduler=None,
            job_func=lambda *a, **k: None,
        )
        assert msg == "Nothing to acknowledge"


def test_handle_callback_delete_noop_when_missing(
    session_factory: sessionmaker[Session],
) -> None:
    """Delete with no sent log answers with a safe no-op message."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        msg = handle_callback(
            data=callback_data("delete", event_id, "occ", "1h"),
            session=session,
            scheduler=None,
            job_func=lambda *a, **k: None,
        )
        assert msg == "Nothing to delete"


# --- impure wiring ------------------------------------------------------------


def test_parse_chat_id() -> None:
    """The allowlisted user id is parsed into an int chat id."""
    assert _parse_chat_id("123") == 123
    assert _parse_chat_id(None) is None
    assert _parse_chat_id("abc") is None


def test_run_send_raises_without_chat_id() -> None:
    """A None chat id is a hard configuration error (never silently dropped)."""
    sent: list[object] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append(text)

    with pytest.raises(RuntimeError, match="chat id not configured"):
        _run_send(FakeBot(), None, "text", 1, "occ", "1h")
    assert sent == []


def test_run_send_drives_coroutine_without_loop() -> None:
    """With no running loop (scheduler thread) the coroutine is awaited directly."""
    sent: list[dict[str, object]] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append({"chat_id": chat_id, "text": text, "markup": reply_markup})

    _run_send(FakeBot(), 123, "hello", 7, "occ", "1h")
    assert len(sent) == 1
    assert sent[0]["chat_id"] == 123
    assert sent[0]["text"] == "hello"
    assert sent[0]["markup"]["inline_keyboard"][0][0]["text"] == "✅ Ack"


def test_run_send_schedules_on_running_loop() -> None:
    """Inside a running loop the card is scheduled as a task (telegram handler)."""
    import asyncio

    sent: list[dict[str, object]] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append({"chat_id": chat_id, "text": text, "markup": reply_markup})

    async def scenario() -> None:
        _run_send(FakeBot(), 123, "hello", 7, "occ", "1h")
        # Give the scheduled task a chance to run.
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    asyncio.run(scenario())
    assert len(sent) == 1
    assert sent[0]["chat_id"] == 123
    assert sent[0]["text"] == "hello"


def test_make_telegram_job_func_sends_and_records(
    session_factory: sessionmaker[Session],
) -> None:
    """The job func sends a card and records a sent DeliveryLog (at-least-once)."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[dict[str, object]] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append({"chat_id": chat_id, "text": text, "markup": reply_markup})

    settings = Settings(telegram_user_id="123", telegram_bot_token="token")
    job_func = make_telegram_job_func(session_factory, FakeBot(), settings, now=_now())

    assert job_func(event_id, "occ", "1h") is True
    assert len(sent) == 1
    assert sent[0]["chat_id"] == 123
    assert "Team standup" in sent[0]["text"]
    assert sent[0]["markup"] is not None

    with session_factory() as session:
        assert session.query(DeliveryLog).one().status == "sent"


def test_make_telegram_job_func_idempotent(
    session_factory: sessionmaker[Session],
) -> None:
    """Sending the same reminder twice only sends once (dedupe)."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append(text)

    settings = Settings(telegram_user_id="123", telegram_bot_token="token")
    job_func = make_telegram_job_func(session_factory, FakeBot(), settings, now=_now())

    assert job_func(event_id, "occ", "1h") is True
    assert job_func(event_id, "occ", "1h") is False
    assert len(sent) == 1


def test_make_telegram_job_func_skips_low_priority(
    session_factory: sessionmaker[Session],
) -> None:
    """Low-priority events are not pushed to Telegram."""
    with session_factory() as session:
        event = _event(priority=EventPriority.LOW)
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append(text)

    settings = Settings(telegram_user_id="123", telegram_bot_token="token")
    job_func = make_telegram_job_func(session_factory, FakeBot(), settings, now=_now())

    assert job_func(event_id, "occ", "1h") is True  # recorded, but not pushed
    assert sent == []


def test_make_telegram_job_func_skips_disallowed_channel(
    session_factory: sessionmaker[Session],
) -> None:
    """An event not configured for Telegram is not pushed (channel filter)."""
    with session_factory() as session:
        event = _event(channels=[EventChannel.EMAIL])
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append(text)

    settings = Settings(telegram_user_id="123", telegram_bot_token="token")
    job_func = make_telegram_job_func(session_factory, FakeBot(), settings, now=_now())

    assert job_func(event_id, "occ", "1h") is True  # recorded, but not pushed
    assert sent == []


def test_make_telegram_job_func_omits_snooze_button_when_disallowed(
    session_factory: sessionmaker[Session],
) -> None:
    """The card omits Snooze when the event's snooze_allowed is False."""
    with session_factory() as session:
        event = _event(snooze_allowed=False)
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[dict[str, object]] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append({"text": text, "markup": reply_markup})

    settings = Settings(telegram_user_id="123", telegram_bot_token="token")
    job_func = make_telegram_job_func(session_factory, FakeBot(), settings, now=_now())

    assert job_func(event_id, "occ", "1h") is True
    assert len(sent) == 1
    row = sent[0]["markup"]["inline_keyboard"][0]
    assert [b["text"] for b in row] == ["✅ Ack", "🗑 Delete"]


def test_make_telegram_job_func_repeat_until_ack_schedules_followup(
    session_factory: sessionmaker[Session], tmp_path: Path
) -> None:
    """A repeat-until-ack event re-schedules a follow-up reminder."""
    with session_factory() as session:
        event = _event(repeat_until_ack=True)
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append(text)

    settings = Settings(data_dir=tmp_path, db_name="telegram.db")
    scheduler = build_scheduler(settings)
    try:
        job_func = make_telegram_job_func(
            session_factory, FakeBot(), settings, now=_now(), scheduler=scheduler
        )
        assert job_func(event_id, "occ", "1h") is True
        assert len(sent) == 1
        # A follow-up job with a distinct occurrence id was scheduled.
        jobs = scheduler.get_jobs()
        assert len(jobs) == 1
        assert "~repeat@" in jobs[0].id
    finally:
        with contextlib.suppress(Exception):
            scheduler.shutdown(wait=False)


def test_make_telegram_job_func_no_repeat_when_acked(
    session_factory: sessionmaker[Session], tmp_path: Path
) -> None:
    """An acknowledged reminder is not re-scheduled (repeat stops on ack)."""
    with session_factory() as session:
        event = _event(repeat_until_ack=True)
        session.add(event)
        session.flush()
        session.add(
            DeliveryLog(
                event_id=event.id,
                occurrence_id="occ",
                offset="1h",
                status="acked",
            )
        )
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append(text)

    settings = Settings(data_dir=tmp_path, db_name="telegram.db")
    scheduler = build_scheduler(settings)
    try:
        job_func = make_telegram_job_func(
            session_factory, FakeBot(), settings, now=_now(), scheduler=scheduler
        )
        # Base delivery already acked -> no repeat scheduled.
        assert job_func(event_id, "occ", "1h") is True
        assert scheduler.get_jobs() == []
    finally:
        with contextlib.suppress(Exception):
            scheduler.shutdown(wait=False)


def test_ack_delivery_acks_base_of_repeat(
    session_factory: sessionmaker[Session],
) -> None:
    """Acknowledging a repeat delivery acks its base occurrence (stops loop)."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        session.add(
            DeliveryLog(
                event_id=event.id, occurrence_id="occ", offset="1h", status="sent"
            )
        )
        session.commit()
        event_id = event.id

    with session_factory() as session:
        ok = ack_delivery(session, event_id, "occ~repeat@20260101090000", "1h")
        assert ok is True
        session.commit()
    with session_factory() as session:
        assert session.query(DeliveryLog).one().status == "acked"


def test_snooze_allowed_for_event(session_factory: sessionmaker[Session]) -> None:
    """snooze_allowed_for_event reflects the per-event flag."""
    with session_factory() as session:
        allowed = _event(snooze_allowed=True)
        disallowed = _event(snooze_allowed=False)
        session.add_all([allowed, disallowed])
        session.commit()
        allowed_id = allowed.id
        disallowed_id = disallowed.id

    with session_factory() as session:
        assert snooze_allowed_for_event(session, allowed_id) is True
        assert snooze_allowed_for_event(session, disallowed_id) is False
        assert snooze_allowed_for_event(session, 99999) is False


def test_handle_callback_snooze_rejected_when_disallowed(
    session_factory: sessionmaker[Session],
) -> None:
    """A Snooze callback for a snooze-disabled event is refused."""
    with session_factory() as session:
        event = _event(snooze_allowed=False)
        session.add(event)
        session.flush()
        _add_sent_log(session, event.id)
        session.commit()
        event_id = event.id

    with session_factory() as session:
        msg = handle_callback(
            data=callback_data("snooze", event_id, "occ", "1h"),
            session=session,
            scheduler=None,
            job_func=lambda *a, **k: None,
        )
        assert msg == "Snooze not allowed"
        # The delivery is left untouched (not snoozed).
        assert session.query(DeliveryLog).one().status == "sent"


def test_make_telegram_job_func_denies_unconfigured_user(
    session_factory: sessionmaker[Session],
) -> None:
    """With no configured user the send fails closed (recorded as failed)."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append(text)

    settings = Settings(telegram_user_id=None, telegram_bot_token="token")
    job_func = make_telegram_job_func(session_factory, FakeBot(), settings, now=_now())

    with pytest.raises(PermissionError):
        job_func(event_id, "occ", "1h")
    assert sent == []
    with session_factory() as session:
        assert session.query(DeliveryLog).one().status == "failed"


def test_make_telegram_job_func_missing_event(
    session_factory: sessionmaker[Session],
) -> None:
    """A job for a deleted event never sends and raises (no silent drop)."""
    settings = Settings(telegram_user_id="123", telegram_bot_token="token")
    sent: list[object] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append(text)

    job_func = make_telegram_job_func(session_factory, FakeBot(), settings, now=_now())

    with pytest.raises(IntegrityError):
        job_func(999, "occ", "1h")
    assert sent == []


def test_build_telegram_application() -> None:
    """No token -> None; with token -> an Application is built."""
    assert build_telegram_application(Settings(telegram_bot_token=None)) is None
    app = build_telegram_application(
        Settings(telegram_bot_token="123:abc", telegram_user_id="1")
    )
    assert app is not None
    assert app.bot.token == "123:abc"
