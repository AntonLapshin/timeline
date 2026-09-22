"""Tests for the retrospective outage catch-up on startup.

Covers the startup mechanism that re-sends reminders due while the service
was down: the pure ``missed_reminders_plan`` window, the impure
``catch_up_missed`` batch scheduling (idempotent via ``DeliveryLog`` +
dedupe key, bounded lookback for performance), and the retrospective
"missed" Telegram card (``overdue_text`` / ``is_missed_delivery`` /
``format_reminder_card(is_missed=True)`` + auto-detection in the job func).
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.enums import EventChannel, EventPriority, EventSource, EventStatus, EventType
from app.models import DeliveryLog, Event
from app.scheduler import (
    build_scheduler,
    catch_up_missed,
    dedupe_key,
    missed_reminders_plan,
)
from app.telegram_outbound import (
    format_reminder_card,
    is_missed_delivery,
    make_telegram_job_func,
    overdue_text,
)


def _shutdown(scheduler: BackgroundScheduler) -> None:
    with contextlib.suppress(Exception):  # noqa: BLE001 - already stopped is fine
        scheduler.shutdown(wait=False)


def _event(**overrides: object) -> Event:
    values: dict[str, object] = {
        "title": "Team standup",
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


def _db(
    tmp_path: Path, name: str = "catchup.db"
) -> tuple[Settings, sessionmaker[Session]]:
    settings = Settings(data_dir=tmp_path, db_name=name)
    engine = create_engine_from_settings(settings)
    models.Base.metadata.create_all(engine)
    return settings, make_session_factory(engine)


def _wire_scheduler(tmp_path: Path) -> BackgroundScheduler:
    return build_scheduler(Settings(data_dir=tmp_path, db_name="sched.db"))


# --- missed_reminders_plan (pure) -------------------------------------------


def test_missed_plan_finds_reminder_due_during_outage() -> None:
    """A 09:00 reminder missed during a morning outage is reported at noon."""
    event = SimpleNamespace(
        id=1,
        tz="UTC",
        rrule=None,
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        end_at=None,
        all_day=False,
        reminder_offsets=["1h"],
        remind_time_of_day=None,
        repeat_until_ack=False,
        channels=[EventChannel.TELEGRAM],
        snooze_allowed=True,
    )
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    plan = missed_reminders_plan(event, now, lookback_days=7)
    assert len(plan) == 1
    assert plan[0].run_at == datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
    assert plan[0].occurrence_id == "2026-01-01T10:00:00+00:00"


def test_missed_plan_skips_future_and_outside_lookback() -> None:
    """Future reminders and ones older than the lookback are not missed."""
    event = SimpleNamespace(
        id=1,
        tz="UTC",
        rrule=None,
        start_at=datetime(2026, 1, 10, 10, 0, tzinfo=UTC),
        end_at=None,
        all_day=False,
        reminder_offsets=["1h"],
        remind_time_of_day=None,
        repeat_until_ack=False,
        channels=[EventChannel.TELEGRAM],
        snooze_allowed=True,
    )
    # Reminder due Jan 10 09:00, now is Jan 1 -> future, not missed.
    assert missed_reminders_plan(event, datetime(2026, 1, 1, 12, 0, tzinfo=UTC)) == []

    # Same event, now long after: run time is older than a 1-day lookback.
    late = datetime(2026, 2, 1, 12, 0, tzinfo=UTC)
    assert missed_reminders_plan(event, late, lookback_days=1) == []
    # ...but visible with the default 7-day window only when within it;
    # Jan 10 09:00 is 22 days before Feb 1, so still outside even 7d.
    assert missed_reminders_plan(event, late, lookback_days=7) == []


def test_missed_plan_empty_without_offsets_or_lookback() -> None:
    """No offsets (or a non-positive lookback) means nothing to catch up."""
    base: dict[str, object] = {
        "id": 1,
        "tz": "UTC",
        "rrule": None,
        "start_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        "end_at": None,
        "all_day": False,
        "remind_time_of_day": None,
        "repeat_until_ack": False,
        "channels": [EventChannel.TELEGRAM],
        "snooze_allowed": True,
    }
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    empty = SimpleNamespace(**{**base, "reminder_offsets": []})
    assert missed_reminders_plan(empty, now) == []
    one_hour = SimpleNamespace(**{**base, "reminder_offsets": ["1h"]})
    assert missed_reminders_plan(one_hour, now, lookback_days=0) == []


# --- catch_up_missed (impure) -------------------------------------------------


def test_catch_up_schedules_missed_and_skips_delivered(tmp_path: Path) -> None:
    """Undelivered due reminders are scheduled immediately; sent ones skipped."""
    _, session_factory = _db(tmp_path)
    with session_factory() as session:
        missed = _event(title="Missed")
        done = _event(title="Done", start_at=datetime(2026, 1, 1, 11, 0, tzinfo=UTC))
        session.add_all([missed, done])
        session.flush()
        missed_id, done_id = missed.id, done.id
        session.add(
            DeliveryLog(
                event_id=done_id,
                occurrence_id="2026-01-01T11:00:00+00:00",
                offset="1h",
                status="sent",
            )
        )
        session.commit()

    scheduler = _wire_scheduler(tmp_path)
    try:
        now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
        added = catch_up_missed(
            scheduler, session_factory, job_func=lambda *a, **k: None, now=now
        )
        assert added == 1
        key = dedupe_key(missed_id, "2026-01-01T10:00:00+00:00", "1h")
        job = scheduler.get_job(key)
        assert job is not None
        # Drained to run immediately.
        assert job.trigger.run_date == now
        # Second pass is a no-op (job already pending -> dedupe).
        assert (
            catch_up_missed(
                scheduler, session_factory, job_func=lambda *a, **k: None, now=now
            )
            == 0
        )
    finally:
        _shutdown(scheduler)


def test_catch_up_skips_low_priority_and_non_telegram(tmp_path: Path) -> None:
    """Events that never push (low priority / non-Telegram) schedule nothing."""
    _, session_factory = _db(tmp_path)
    with session_factory() as session:
        session.add(_event(title="Low", priority=EventPriority.LOW))
        session.add(_event(title="Email only", channels=[EventChannel.EMAIL]))
        session.commit()

    scheduler = _wire_scheduler(tmp_path)
    try:
        added = catch_up_missed(
            scheduler,
            session_factory,
            job_func=lambda *a, **k: None,
            now=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        )
        assert added == 0
        assert scheduler.get_jobs() == []
    finally:
        _shutdown(scheduler)


def test_catch_up_treats_acked_as_delivered(tmp_path: Path) -> None:
    """An acked reminder was already handled: never re-sent retrospectively."""
    _, session_factory = _db(tmp_path)
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        session.add(
            DeliveryLog(
                event_id=event.id,
                occurrence_id="2026-01-01T10:00:00+00:00",
                offset="1h",
                status="acked",
            )
        )
        session.commit()

    scheduler = _wire_scheduler(tmp_path)
    try:
        added = catch_up_missed(
            scheduler,
            session_factory,
            job_func=lambda *a, **k: None,
            now=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        )
        assert added == 0
    finally:
        _shutdown(scheduler)


# --- missed card --------------------------------------------------------------


def test_overdue_text() -> None:
    """Overdue durations read as 'X ago'; future targets read as 'now'."""
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    assert overdue_text(now - timedelta(minutes=45), now) == "45m ago"
    assert overdue_text(now - timedelta(hours=2), now) == "2h ago"
    assert overdue_text(now - timedelta(hours=2, minutes=15), now) == "2h 15m ago"
    assert overdue_text(now - timedelta(days=3), now) == "3d ago"
    assert overdue_text(now + timedelta(hours=1), now) == "now"


def test_format_missed_card_marks_outage() -> None:
    """A missed card keeps the event fields but flags the retrospective send."""
    event = _event(title="Dentist", description="Root canal")
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    card = format_reminder_card(
        event, "2026-01-01T10:00:00+00:00", "1h", now=now, is_missed=True
    )
    assert "Missed" in card
    assert "Dentist" in card
    assert "Root canal" in card
    assert "ago" in card
    # The normal card for the same instant has no missed marker.
    normal = format_reminder_card(
        event, "2026-01-01T10:00:00+00:00", "1h", now=now, is_missed=False
    )
    assert "Missed" not in normal


def test_is_missed_delivery_threshold() -> None:
    """A reminder 3h overdue counts as missed; a just-due one does not."""
    event = _event(remind_time_of_day=None)
    late = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    assert is_missed_delivery(event, "2026-01-01T10:00:00+00:00", "1h", late) is True
    on_time = datetime(2026, 1, 1, 9, 0, 30, tzinfo=UTC)
    assert (
        is_missed_delivery(event, "2026-01-01T10:00:00+00:00", "1h", on_time) is False
    )
    # Unparseable occurrence ids fail open to a normal card.
    assert is_missed_delivery(event, "occ-1", "1h", late) is False


def test_job_func_sends_missed_card_for_late_delivery(tmp_path: Path) -> None:
    """A catch-up job firing late delivers the retrospective card text."""
    _, session_factory = _db(tmp_path, name="missed-card.db")
    with session_factory() as session:
        session.add(_event(title="Standup"))
        session.commit()
        event_id = session.query(Event).one().id

    sent: list[str] = []

    class FakeBot:
        async def send_message(self, chat_id, text, reply_markup=None, **kwargs):
            sent.append(text)

    settings = Settings(telegram_user_id="123", telegram_bot_token="token")
    # now_utc is 3h after the 09:00 run time -> late -> missed card.
    job_func = make_telegram_job_func(
        session_factory,
        FakeBot(),
        settings,
        now=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
    assert job_func(event_id, "2026-01-01T10:00:00+00:00", "1h") is True
    assert len(sent) == 1
    assert "Missed" in sent[0]
