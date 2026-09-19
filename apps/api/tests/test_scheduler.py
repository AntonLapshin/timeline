"""Tests for the persistent reminder scheduler (issue #57, M4-T1).

Covers the acceptance criteria:

- **Persistence across restart**: APScheduler's SQLite jobstore keeps pending
  jobs alive across a simulated restart (a rebuilt scheduler on the same DB
  still sees the job).
- **Dedupe on identical schedule**: scheduling the same reminder twice (same
  ``(event_id, occurrence_id, offset)`` dedupe key) is a no-op.
- **At-least-once retry on failure**: a failed delivery records a
  ``DeliveryLog(status="failed")`` and is requeued rather than dropped; the
  retry wrapper re-raises only when the budget is exhausted.

Plus the pure helpers (``parse_offset``, ``dedupe_key``/``parse_dedupe_key``,
``reminder_run_time``, ``schedule_plan``, ``with_retry``) and the impure
wiring (``build_scheduler``, ``add_reminder_job``, ``drain_schedule``,
``requeue_failed``, ``deliver_reminder``).
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from apscheduler.jobstores.base import JobLookupError
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.enums import EventChannel, EventPriority, EventSource, EventStatus, EventType
from app.models import DeliveryLog, Event
from app.scheduler import (
    PlannedReminder,
    add_reminder_job,
    base_occurrence_id,
    build_scheduler,
    channel_allows,
    dedupe_key,
    defer_to_morning_digest,
    deliver_reminder,
    drain_schedule,
    event_job_keys,
    in_quiet_hours,
    parse_dedupe_key,
    parse_offset,
    plan_diff,
    quiet_hours_run_time,
    reminder_run_time,
    remove_event_jobs,
    repeat_until_ack_plan,
    requeue_failed,
    reschedule_for_event,
    schedule_plan,
    should_repeat_until_ack,
    with_retry,
)

# --- fixtures ---------------------------------------------------------------


@pytest.fixture()
def session_factory(tmp_path: Path) -> sessionmaker[Session]:
    """A session factory over an isolated temp DB (for the scheduler wiring)."""
    settings = Settings(data_dir=tmp_path, db_name="scheduler.db")
    engine = create_engine_from_settings(settings)
    models.Base.metadata.create_all(engine)
    return make_session_factory(engine)


def _shutdown(scheduler: BackgroundScheduler) -> None:
    """Tear down a scheduler that may not have been started.

    APScheduler 3.10+ raises ``SchedulerNotRunningError`` when ``shutdown()``
    is called on a scheduler that was never ``start()``-ed, which is the
    case for most wiring tests here (we only add/inspect jobs, never run
    them).
    """
    with contextlib.suppress(Exception):  # noqa: BLE001 - already stopped is fine
        scheduler.shutdown(wait=False)


def _noop_job(*args: object, **kwargs: object) -> object:
    """A placeholder job that accepts the scheduler's kwargs and does nothing."""
    return None


def _event(**overrides: object) -> Event:
    """Build a minimal valid Event with reminder defaults."""
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


def _planned(
    event_id: int = 1,
    occurrence_id: str = "2026-01-01T10:00:00+00:00",
    offset: str = "1h",
    run_at: datetime | None = None,
) -> PlannedReminder:
    return PlannedReminder(
        event_id=event_id,
        occurrence_id=occurrence_id,
        offset=offset,
        run_at=run_at or datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
    )


# --- pure helpers ------------------------------------------------------------


def test_parse_offset_units() -> None:
    """Offsets are parsed into the expected timedelta."""
    assert parse_offset("7d") == timedelta(days=7)
    assert parse_offset("2h") == timedelta(hours=2)
    assert parse_offset("30m") == timedelta(minutes=30)
    assert parse_offset("1w") == timedelta(weeks=1)
    # Case-insensitive and whitespace-tolerant.
    assert parse_offset(" 1H ") == timedelta(hours=1)


def test_parse_offset_invalid() -> None:
    """Malformed offsets raise ValueError."""
    for bad in ("", "tomorrow", "1x", "abc", "1.5h", "h", "-1h"):
        with pytest.raises(ValueError):
            parse_offset(bad)


def test_dedupe_key_roundtrip() -> None:
    """The dedupe key is stable and round-trips through parse_dedupe_key."""
    key = dedupe_key(7, "2026-01-01T10:00:00+00:00", "1h")
    assert key == "7:2026-01-01T10:00:00+00:00:1h"
    assert parse_dedupe_key(key) == (7, "2026-01-01T10:00:00+00:00", "1h")
    # Different inputs produce different keys (never collide).
    assert dedupe_key(7, "a", "1h") != dedupe_key(7, "b", "1h")


def test_reminder_run_time_simple() -> None:
    """Without remind_time_of_day the run time is start - offset in UTC."""
    start = datetime(2026, 1, 1, 10, 0, tzinfo=UTC)
    assert reminder_run_time(start, "1h", None, "UTC") == datetime(
        2026, 1, 1, 9, 0, tzinfo=UTC
    )


def test_reminder_run_time_snap_to_time_of_day() -> None:
    """remind_time_of_day snaps the run time to that local time of day."""
    start = datetime(2026, 1, 1, 10, 0, tzinfo=UTC)
    run = reminder_run_time(start, "1h", "09:00", "UTC")
    # Base is 09:00 UTC; snapping to 09:00 local (UTC) keeps it 09:00.
    assert run == datetime(2026, 1, 1, 9, 0, tzinfo=UTC)

    # A later time-of-day still snaps to the requested wall-clock on that day.
    run2 = reminder_run_time(start, "1h", "08:00", "UTC")
    assert run2 == datetime(2026, 1, 1, 8, 0, tzinfo=UTC)


def test_reminder_run_time_timezone_aware() -> None:
    """The result is always a timezone-aware UTC datetime."""
    start = datetime(2026, 1, 1, 10, 0, tzinfo=UTC)
    run = reminder_run_time(start, "1h", "09:00", "Europe/Berlin")
    assert run.tzinfo is not None
    assert run.utcoffset() == timedelta(0)  # UTC


# --- quiet hours (issue #62, M4-T3A) ----------------------------------------


def test_in_quiet_hours_overnight_window() -> None:
    """The default 22:00-08:00 window defers overnight reminders."""
    # 23:00 UTC is inside the default window.
    assert (
        in_quiet_hours(datetime(2026, 1, 1, 23, 0, tzinfo=UTC), None, None, "UTC")
        is True
    )
    # 02:00 UTC is inside (past midnight).
    assert (
        in_quiet_hours(datetime(2026, 1, 2, 2, 0, tzinfo=UTC), None, None, "UTC")
        is True
    )
    # 09:00 UTC is outside.
    assert (
        in_quiet_hours(datetime(2026, 1, 1, 9, 0, tzinfo=UTC), None, None, "UTC")
        is False
    )


def test_in_quiet_hours_end_is_exclusive() -> None:
    """A reminder exactly at quiet-hours end is not deferred."""
    assert (
        in_quiet_hours(datetime(2026, 1, 1, 8, 0, tzinfo=UTC), None, None, "UTC")
        is False
    )
    # Start boundary (22:00) is inclusive.
    assert (
        in_quiet_hours(datetime(2026, 1, 1, 22, 0, tzinfo=UTC), None, None, "UTC")
        is True
    )


def test_in_quiet_hours_custom_window() -> None:
    """A same-day custom window (e.g. 12:00-14:00) is honored."""
    assert (
        in_quiet_hours(datetime(2026, 1, 1, 13, 0, tzinfo=UTC), "12:00", "14:00", "UTC")
        is True
    )
    assert (
        in_quiet_hours(datetime(2026, 1, 1, 11, 0, tzinfo=UTC), "12:00", "14:00", "UTC")
        is False
    )
    assert (
        in_quiet_hours(datetime(2026, 1, 1, 15, 0, tzinfo=UTC), "12:00", "14:00", "UTC")
        is False
    )


def test_in_quiet_hours_respects_timezone() -> None:
    """The window is evaluated in the event's local timezone."""
    # 22:00 UTC is 23:00 in Europe/Berlin (+1) -> inside default window.
    assert (
        in_quiet_hours(
            datetime(2026, 1, 1, 22, 0, tzinfo=UTC), None, None, "Europe/Berlin"
        )
        is True
    )


def test_defer_to_morning_digest_overnight() -> None:
    """A 23:00 reminder defers to the next morning after quiet-hours end."""
    run = datetime(2026, 1, 1, 23, 0, tzinfo=UTC)
    digest = defer_to_morning_digest(run, None, "UTC")
    # Next morning 08:00 UTC (quiet hours end) on the following day.
    assert digest == datetime(2026, 1, 2, 8, 0, tzinfo=UTC)


def test_defer_to_morning_digest_same_day() -> None:
    """A 06:00 reminder defers to the same-day 08:00 digest (still later)."""
    run = datetime(2026, 1, 1, 6, 0, tzinfo=UTC)
    digest = defer_to_morning_digest(run, None, "UTC")
    assert digest == datetime(2026, 1, 1, 8, 0, tzinfo=UTC)


def test_quiet_hours_run_time_outside_unchanged() -> None:
    """Run times outside quiet hours are returned unchanged."""
    run = datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
    assert quiet_hours_run_time(run, None, None, "UTC") == run


def test_quiet_hours_run_time_defers_inside() -> None:
    """Run times inside quiet hours defer to the next morning digest."""
    run = datetime(2026, 1, 1, 23, 0, tzinfo=UTC)
    assert quiet_hours_run_time(run, None, None, "UTC") == datetime(
        2026, 1, 2, 8, 0, tzinfo=UTC
    )


# --- channels / repeat-until-ack (issue #62, M4-T3A) -------------------------


def test_channel_allows() -> None:
    """Delivery only happens on configured channels."""
    assert channel_allows([EventChannel.TELEGRAM], EventChannel.TELEGRAM) is True
    assert channel_allows([EventChannel.EMAIL], EventChannel.TELEGRAM) is False
    assert channel_allows([], EventChannel.TELEGRAM) is False
    assert (
        channel_allows([EventChannel.TELEGRAM, EventChannel.EMAIL], EventChannel.EMAIL)
        is True
    )


def test_should_repeat_until_ack() -> None:
    """Repeat only while unacknowledged and the flag is set."""
    assert should_repeat_until_ack(True, False) is True
    assert should_repeat_until_ack(True, True) is False
    assert should_repeat_until_ack(False, False) is False
    assert should_repeat_until_ack(False, True) is False


def test_base_occurrence_id_strips_repeat_marker() -> None:
    """Repeat/snooze suffixes are stripped to trace back to the base delivery."""
    assert base_occurrence_id("occ~repeat@20260101120000") == "occ"
    assert base_occurrence_id("occ~snooze@20260101120000") == "occ"
    assert base_occurrence_id("occ") == "occ"


def test_repeat_until_ack_plan_returns_none_when_disabled() -> None:
    """An event without repeat_until_ack schedules no follow-up."""
    event = SimpleNamespace(id=1, repeat_until_ack=False)
    assert (
        repeat_until_ack_plan(
            event, "occ", "1h", datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
        )
        is None
    )


def test_repeat_until_ack_plan_schedules_followup() -> None:
    """A repeat-until-ack event schedules a distinct follow-up one hour later."""
    event = SimpleNamespace(id=1, repeat_until_ack=True)
    delivered = datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
    plan = repeat_until_ack_plan(event, "occ", "1h", delivered)
    assert plan is not None
    assert plan.event_id == 1
    assert plan.offset == "1h"
    assert plan.run_at == delivered + timedelta(hours=1)
    assert plan.occurrence_id != "occ"
    assert base_occurrence_id(plan.occurrence_id) == "occ"


def test_repeat_until_ack_plan_custom_interval() -> None:
    """A custom repeat interval is honored."""
    event = SimpleNamespace(id=1, repeat_until_ack=True)
    delivered = datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
    plan = repeat_until_ack_plan(
        event, "occ", "1h", delivered, repeat_interval=timedelta(days=1)
    )
    assert plan is not None
    assert plan.run_at == delivered + timedelta(days=1)


def _plan_event(**overrides: object) -> SimpleNamespace:
    """A minimal schedulable-event input for schedule_plan."""
    values: dict[str, object] = {
        "id": 1,
        "tz": "UTC",
        "rrule": None,
        "start_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        "end_at": None,
        "all_day": False,
        "reminder_offsets": ["1h"],
        "remind_time_of_day": None,
        "repeat_until_ack": False,
        "channels": [EventChannel.TELEGRAM],
        "snooze_allowed": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_schedule_plan_no_offsets() -> None:
    """An event with no reminder offsets produces no plan."""
    event = _plan_event(reminder_offsets=[])
    assert schedule_plan(event, datetime(2025, 12, 1, tzinfo=UTC)) == []


def test_schedule_plan_one_time() -> None:
    """A one-time event with offsets yields one reminder per offset."""
    now = datetime(2025, 12, 1, tzinfo=UTC)
    event = _plan_event(reminder_offsets=["1h", "1d"])
    plan = schedule_plan(event, now)
    assert len(plan) == 2
    assert {p.offset for p in plan} == {"1h", "1d"}
    assert all(p.event_id == 1 for p in plan)
    # Sorted by run time (1d before 1h).
    assert plan[0].offset == "1d"


def test_schedule_plan_skips_past_and_horizon() -> None:
    """Reminders whose run time is in the past or beyond the horizon are skipped."""
    now = datetime(2026, 1, 1, 10, 30, tzinfo=UTC)
    event = _plan_event(reminder_offsets=["1h", "2h"])
    plan = schedule_plan(event, now)
    # Both run times (09:00 / 08:00) are in the past -> nothing scheduled.
    assert plan == []

    # An event far in the future beyond the horizon is also skipped.
    far = _plan_event(start_at=now + timedelta(days=400))
    assert schedule_plan(far, now) == []


def test_schedule_plan_recurrent() -> None:
    """Recurrent events schedule one reminder per upcoming occurrence."""
    now = datetime(2025, 12, 1, tzinfo=UTC)
    event = _plan_event(
        rrule="FREQ=DAILY",
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        reminder_offsets=["1h"],
    )
    plan = schedule_plan(event, now)
    # Multiple daily occurrences within the horizon each yield one reminder.
    assert len(plan) > 1
    occurrence_ids = {p.occurrence_id for p in plan}
    assert len(occurrence_ids) == len(plan)  # unique occurrence per reminder


def test_schedule_plan_applies_quiet_hours() -> None:
    """A reminder run time inside quiet hours is deferred to the morning digest."""
    now = datetime(2025, 12, 1, tzinfo=UTC)
    # Event at 23:00 with a 1h offset -> run time 22:00 (inside quiet hours).
    event = _plan_event(
        start_at=datetime(2026, 1, 1, 23, 0, tzinfo=UTC),
        reminder_offsets=["1h"],
        remind_time_of_day=None,
    )
    plan = schedule_plan(event, now)
    assert len(plan) == 1
    # Deferred to the next morning 08:00 UTC after quiet hours end.
    assert plan[0].run_at == datetime(2026, 1, 2, 8, 0, tzinfo=UTC)


def test_schedule_plan_respects_custom_quiet_hours() -> None:
    """Per-event quiet hours override the default window."""
    now = datetime(2025, 12, 1, tzinfo=UTC)
    # Custom window 00:00-06:00; run time 22:00 is outside -> unchanged.
    event = _plan_event(
        start_at=datetime(2026, 1, 1, 23, 0, tzinfo=UTC),
        reminder_offsets=["1h"],
        quiet_hours_start="00:00",
        quiet_hours_end="06:00",
    )
    plan = schedule_plan(event, now)
    assert len(plan) == 1
    assert plan[0].run_at == datetime(2026, 1, 1, 22, 0, tzinfo=UTC)


# --- retry wrapper (at-least-once) -------------------------------------------


def test_with_retry_success() -> None:
    """A successful run is not retried."""
    calls: list[int] = []
    requeues: list[int] = []

    def job() -> object:
        calls.append(1)
        return "ok"

    wrapped = with_retry(job, requeue=requeues.append)
    assert wrapped() == "ok"
    assert calls == [1]
    assert requeues == []


def test_with_retry_requeues_then_succeeds() -> None:
    """A failure requeues (at-least-once) and a later run can succeed."""
    attempts: list[int] = []
    requeues: list[int] = []

    def job() -> object:
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("boom")
        return "ok"

    wrapped = with_retry(job, max_retries=3, requeue=requeues.append)
    assert wrapped() is None  # first failure is swallowed + requeued
    assert requeues == [2]  # remaining budget (after decrement) reported
    assert wrapped() == "ok"
    assert requeues == [2]


def test_with_retry_exhausts_budget() -> None:
    """When the retry budget is exhausted the exception is re-raised."""
    requeues: list[int] = []

    def job() -> object:
        raise RuntimeError("boom")

    wrapped = with_retry(job, max_retries=2, requeue=requeues.append)
    assert wrapped() is None  # failure 1 -> requeue, 1 left
    assert wrapped() is None  # failure 2 -> requeue, 0 left
    with pytest.raises(RuntimeError):
        wrapped()  # budget exhausted -> re-raise
    assert requeues == [1, 0]


# --- deliver_reminder ---------------------------------------------------------


def test_deliver_reminder_records_sent(session_factory: sessionmaker[Session]) -> None:
    """A successful delivery records a DeliveryLog(status='sent')."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        event_id = event.id
        session.commit()

    sent: list[bool] = []

    def send() -> object:
        sent.append(True)
        return True

    result = deliver_reminder(session_factory, event_id, "occ", "1h", send=send)
    assert result is True
    assert sent == [True]
    with session_factory() as session:
        logs = session.query(DeliveryLog).all()
        assert len(logs) == 1
        assert logs[0].event_id == event_id
        assert logs[0].occurrence_id == "occ"
        assert logs[0].offset == "1h"
        assert logs[0].status == "sent"
        assert logs[0].sent_at is not None


def test_deliver_reminder_idempotent(session_factory: sessionmaker[Session]) -> None:
    """Delivering the same reminder twice only sends once (dedupe)."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        event_id = event.id
        session.commit()

    sent: list[bool] = []

    def send() -> object:
        sent.append(True)
        return True

    assert deliver_reminder(session_factory, event_id, "occ", "1h", send=send) is True
    # Second attempt for the same key is a no-op.
    assert deliver_reminder(session_factory, event_id, "occ", "1h", send=send) is False
    assert len(sent) == 1
    with session_factory() as session:
        assert session.query(DeliveryLog).filter_by(status="sent").count() == 1


def test_deliver_reminder_records_failure(
    session_factory: sessionmaker[Session],
) -> None:
    """A failed send records DeliveryLog(status='failed') and re-raises."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        event_id = event.id
        session.commit()

    def send() -> object:
        raise RuntimeError("telegram down")

    with pytest.raises(RuntimeError):
        deliver_reminder(session_factory, event_id, "occ", "1h", send=send)

    with session_factory() as session:
        logs = session.query(DeliveryLog).all()
        assert len(logs) == 1
        assert logs[0].status == "failed"
        assert "telegram down" in (logs[0].error or "")


# --- scheduler wiring ---------------------------------------------------------


def test_build_scheduler_uses_sqlite_jobstore(tmp_path: Path) -> None:
    """build_scheduler wires a persistent SQLite jobstore under data/."""
    settings = Settings(data_dir=tmp_path, db_name="scheduler.db")
    scheduler = build_scheduler(settings)
    try:
        assert isinstance(scheduler, BackgroundScheduler)
        # The default jobstore is backed by SQLAlchemy (SQLite), so jobs
        # persist across restarts. ``_jobstores`` is populated at construction
        # even before the scheduler is started.
        jobstore = scheduler._jobstores["default"]  # noqa: SLF001 - test
        assert isinstance(jobstore, SQLAlchemyJobStore)
    finally:
        _shutdown(scheduler)


def test_add_reminder_job_dedupe() -> None:
    """Scheduling the same reminder twice only adds one job (dedupe key)."""
    settings = Settings(data_dir=Path("/tmp"), db_name=f"sched-{id(object())}.db")
    scheduler = build_scheduler(settings)
    try:
        planned = _planned()
        first = add_reminder_job(scheduler, planned, _noop_job)
        assert first == dedupe_key(1, planned.occurrence_id, "1h")
        # Identical schedule -> no-op.
        second = add_reminder_job(scheduler, planned, _noop_job)
        assert second is None
        assert scheduler.get_job(dedupe_key(1, planned.occurrence_id, "1h")) is not None
    finally:
        _shutdown(scheduler)


def test_add_reminder_job_drains_missed() -> None:
    """A reminder whose run time passed is drained to run immediately."""
    settings = Settings(data_dir=Path("/tmp"), db_name=f"sched-{id(object())}.db")
    scheduler = build_scheduler(settings)
    try:
        now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
        planned = _planned(run_at=datetime(2026, 1, 1, 9, 0, tzinfo=UTC))  # missed
        key = add_reminder_job(scheduler, planned, _noop_job, now=now)
        assert key is not None
        job = scheduler.get_job(key)
        assert job is not None
        # Drained to now (immediate) rather than the missed time.
        assert job.trigger.run_date == now
    finally:
        _shutdown(scheduler)


def _make_db(tmp_path: Path, name: str) -> tuple[Settings, sessionmaker[Session]]:
    settings = Settings(data_dir=tmp_path, db_name=name)
    engine = create_engine_from_settings(settings)
    models.Base.metadata.create_all(engine)
    return settings, make_session_factory(engine)


def test_job_persistence_across_restart(tmp_path: Path) -> None:
    """A scheduled job survives a simulated app restart (persistent jobstore).

    We schedule a reminder on scheduler A, shut it down, then build scheduler B
    on the same SQLite DB and confirm the job is still there.
    """
    settings, _ = _make_db(tmp_path, "scheduler.db")
    future = datetime.now(UTC) + timedelta(days=30)
    planned = _planned(occurrence_id="occ-future", run_at=future)

    scheduler_a = build_scheduler(settings)
    scheduler_a.start()
    try:
        key = add_reminder_job(scheduler_a, planned, _noop_job)
        assert key is not None
        assert scheduler_a.get_job(key) is not None
    finally:
        _shutdown(scheduler_a)

    # Simulated restart: a fresh scheduler over the same DB / jobstore. It
    # must be started to read the persisted jobs out of the SQLite store.
    scheduler_b = build_scheduler(settings)
    scheduler_b.start()
    try:
        job = scheduler_b.get_job(key)
        assert job is not None
        assert job.id == key
    finally:
        _shutdown(scheduler_b)


def test_drain_schedule_schedules_active_events(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """drain_schedule reads per-event config from the DB and schedules jobs."""
    settings, _ = _make_db(tmp_path, "scheduler.db")
    with session_factory() as session:
        session.add(
            _event(
                start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
                reminder_offsets=["1h"],
            )
        )
        session.commit()

    scheduler = build_scheduler(settings)
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        added = drain_schedule(scheduler, session_factory, job_func=_noop_job, now=now)
        assert added == 1
        jobs = scheduler.get_jobs()
        assert len(jobs) == 1
        assert jobs[0].trigger.run_date == datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
    finally:
        _shutdown(scheduler)


def test_drain_schedule_skips_inactive(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """Inactive (archived) events are not scheduled."""
    settings, _ = _make_db(tmp_path, "scheduler.db")
    with session_factory() as session:
        session.add(
            _event(
                start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
                reminder_offsets=["1h"],
                status=EventStatus.ARCHIVED,
            )
        )
        session.commit()

    scheduler = build_scheduler(settings)
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        added = drain_schedule(scheduler, session_factory, job_func=_noop_job, now=now)
        assert added == 0
        assert scheduler.get_jobs() == []
    finally:
        _shutdown(scheduler)


def test_drain_schedule_idempotent(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """Draining twice does not double-schedule (dedupe on identical schedule)."""
    settings, _ = _make_db(tmp_path, "scheduler.db")
    with session_factory() as session:
        session.add(
            _event(
                start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
                reminder_offsets=["1h"],
            )
        )
        session.commit()

    scheduler = build_scheduler(settings)
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        assert (
            drain_schedule(scheduler, session_factory, job_func=_noop_job, now=now) == 1
        )
        # Second drain: no new jobs (same dedupe keys).
        assert (
            drain_schedule(scheduler, session_factory, job_func=_noop_job, now=now) == 0
        )
        assert len(scheduler.get_jobs()) == 1
    finally:
        _shutdown(scheduler)


def test_requeue_failed_reattempts(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """Failed deliveries are requeued rather than dropped (at-least-once)."""
    settings, _ = _make_db(tmp_path, "scheduler.db")
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        session.add(
            DeliveryLog(
                event_id=event.id,
                occurrence_id="2026-01-01T10:00:00+00:00",
                offset="1h",
                status="failed",
                error="telegram down",
            )
        )
        session.commit()

    scheduler = build_scheduler(settings)
    try:
        now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
        requeued = requeue_failed(
            scheduler, session_factory, job_func=_noop_job, now=now
        )
        assert requeued == 1
        jobs = scheduler.get_jobs()
        assert len(jobs) == 1
        assert jobs[0].id == dedupe_key(event.id, "2026-01-01T10:00:00+00:00", "1h")
        # Drained to run immediately (at-least-once).
        assert jobs[0].trigger.run_date == now
    finally:
        _shutdown(scheduler)


def test_requeue_failed_skips_sent(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """Only failed deliveries are requeued; sent ones are left alone."""
    settings, _ = _make_db(tmp_path, "scheduler.db")
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        session.add(
            DeliveryLog(
                event_id=event.id,
                occurrence_id="occ-a",
                offset="1h",
                status="failed",
            )
        )
        session.add(
            DeliveryLog(
                event_id=event.id,
                occurrence_id="occ-b",
                offset="1h",
                status="sent",
            )
        )
        session.commit()

    scheduler = build_scheduler(settings)
    try:
        requeued = requeue_failed(
            scheduler,
            session_factory,
            job_func=_noop_job,
            now=datetime(2026, 1, 1, tzinfo=UTC),
        )
        assert requeued == 1
        jobs = scheduler.get_jobs()
        assert len(jobs) == 1
        assert jobs[0].id == dedupe_key(event.id, "occ-a", "1h")
    finally:
        _shutdown(scheduler)


def test_requeue_failed_skips_missing_fields(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """Malformed failed logs (missing occurrence_id/offset) are skipped.

    A failed DeliveryLog row with ``occurrence_id`` or ``offset`` set to None
    cannot be requeued (its dedupe key is incomplete), so ``requeue_failed``
    must skip it and schedule no job.
    """
    settings, _ = _make_db(tmp_path, "scheduler.db")
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.flush()
        session.add(
            DeliveryLog(
                event_id=event.id,
                occurrence_id=None,
                offset="1h",
                status="failed",
            )
        )
        session.add(
            DeliveryLog(
                event_id=event.id,
                occurrence_id="occ-a",
                offset=None,
                status="failed",
            )
        )
        session.commit()

    scheduler = build_scheduler(settings)
    try:
        requeued = requeue_failed(
            scheduler,
            session_factory,
            job_func=_noop_job,
            now=datetime(2026, 1, 1, tzinfo=UTC),
        )
        assert requeued == 0
        assert scheduler.get_jobs() == []
    finally:
        _shutdown(scheduler)


# --- runtime event re-scheduling (issue #134, M10-T1) -------------------------


def _wire_scheduler() -> BackgroundScheduler:
    """A throwaway scheduler for reschedule wiring tests (never started)."""
    return build_scheduler(
        Settings(data_dir=Path("/tmp"), db_name=f"resched-{id(object())}.db")
    )


def _add_job(
    scheduler: BackgroundScheduler,
    event_id: int,
    occurrence_id: str,
    offset: str,
    run_at: datetime,
    *,
    now: datetime | None = None,
) -> str:
    """Schedule one reminder via the normal add path and return its key."""
    key = add_reminder_job(
        scheduler,
        PlannedReminder(
            event_id=event_id,
            occurrence_id=occurrence_id,
            offset=offset,
            run_at=run_at,
        ),
        _noop_job,
        now=now,
    )
    assert key is not None
    return key


def test_event_job_keys_lists_pending_only() -> None:
    """event_job_keys returns pending jobs of one event, keyed by dedupe key."""
    scheduler = _wire_scheduler()
    try:
        # 'now' predates every run time so nothing is drained to real-now.
        past = datetime(2025, 12, 1, tzinfo=UTC)
        _add_job(
            scheduler,
            1,
            "2026-01-01T10:00:00+00:00",
            "1h",
            datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
            now=past,
        )
        _add_job(
            scheduler,
            1,
            "2026-01-02T10:00:00+00:00",
            "1d",
            datetime(2025, 12, 31, 10, 0, tzinfo=UTC),
            now=past,
        )
        # A follow-up job for the same event (repeat-until-ack marker).
        _add_job(
            scheduler,
            1,
            "2026-01-01T10:00:00+00:00~repeat@1",
            "1h",
            datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
            now=past,
        )
        # A different event's job and a non-event job must be excluded.
        _add_job(
            scheduler,
            11,
            "2026-01-01T10:00:00+00:00",
            "1h",
            datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
            now=past,
        )
        scheduler.add_job(
            _noop_job,
            "date",
            run_date=datetime(2026, 1, 1, tzinfo=UTC),
            id="unrelated-job",
        )

        keys = event_job_keys(scheduler, 1)
        assert set(keys) == {
            dedupe_key(1, "2026-01-01T10:00:00+00:00", "1h"),
            dedupe_key(1, "2026-01-01T10:00:00+00:00~repeat@1", "1h"),
            dedupe_key(1, "2026-01-02T10:00:00+00:00", "1d"),
        }
        assert keys[dedupe_key(1, "2026-01-01T10:00:00+00:00", "1h")] == datetime(
            2026, 1, 1, 9, 0, tzinfo=UTC
        )
        # Event 11 is distinguished from event 1 by the colon in the prefix.
        assert set(event_job_keys(scheduler, 11)) == {
            dedupe_key(11, "2026-01-01T10:00:00+00:00", "1h")
        }
    finally:
        _shutdown(scheduler)


def test_event_job_keys_started_scheduler_next_run_time(tmp_path: Path) -> None:
    """On a started scheduler the primary ``next_run_time`` path is used.

    A not-yet-started scheduler only exposes the trigger's ``run_date`` (the
    fallback the previous test pins); once started, APScheduler tracks
    ``next_run_time`` on the job itself — the path real running schedulers
    exercise (review finding on PR #137).
    """
    scheduler = build_scheduler(Settings(data_dir=tmp_path, db_name="keys.db"))
    scheduler.start()
    try:
        future = datetime.now(UTC) + timedelta(days=30)
        key = _add_job(scheduler, 1, "2026-01-01T10:00:00+00:00", "1h", future)
        job = scheduler.get_job(key)
        assert job is not None
        assert job.next_run_time == future  # primary path is live
        keys = event_job_keys(scheduler, 1)
        assert set(keys) == {key}
        assert keys[key] == future
    finally:
        _shutdown(scheduler)


def test_plan_diff_adds_missing_and_removes_stale() -> None:
    """plan_diff returns desired-but-missing entries and stale keys."""
    existing = {
        dedupe_key(1, "2026-01-01T10:00:00+00:00", "1h"): datetime(
            2026, 1, 1, 9, 0, tzinfo=UTC
        ),
        "1:occ-gone:1d": datetime(2026, 1, 2, 9, 0, tzinfo=UTC),
    }
    desired = [
        _planned(),  # occ-a/1h — already scheduled identically
        _planned(occurrence_id="2026-01-03T10:00:00+00:00"),
    ]
    to_add, to_remove = plan_diff(existing, desired)
    assert [p.occurrence_id for p in to_add] == ["2026-01-03T10:00:00+00:00"]
    assert to_remove == ["1:occ-gone:1d"]


def test_plan_diff_flags_changed_run_time() -> None:
    """A same-key reminder whose run time changed is re-added (not removed)."""
    existing = {
        "1:2026-01-01T10:00:00+00:00:1h": datetime(2026, 1, 1, 8, 0, tzinfo=UTC)
    }
    to_add, to_remove = plan_diff(existing, [_planned()])
    assert [p.occurrence_id for p in to_add] == ["2026-01-01T10:00:00+00:00"]
    assert to_remove == []


def test_plan_diff_noop_on_identical_plan() -> None:
    """An unchanged plan diffs to empty add/remove lists."""
    planned = _planned()
    existing = {dedupe_key(1, planned.occurrence_id, "1h"): planned.run_at}
    assert plan_diff(existing, [planned]) == ([], [])


def test_reschedule_for_event_schedules_new_event() -> None:
    """Creating an event with a running scheduler schedules its jobs (#133)."""
    event = _event(
        id=1,
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        reminder_offsets=["1h", "1d"],
    )
    scheduler = _wire_scheduler()
    try:
        added, removed = reschedule_for_event(
            scheduler, event, _noop_job, now=datetime(2025, 12, 1, tzinfo=UTC)
        )
        assert (added, removed) == (2, 0)
        assert len(event_job_keys(scheduler, event.id)) == 2
    finally:
        _shutdown(scheduler)


def test_reschedule_for_event_update_moves_jobs() -> None:
    """Moving an event replaces its jobs: no stale duplicates, dedupe holds."""
    event = _event(id=1, start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    scheduler = _wire_scheduler()
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        reschedule_for_event(scheduler, event, _noop_job, now=now)
        old_key = dedupe_key(event.id, "2026-01-01T10:00:00+00:00", "1h")
        assert scheduler.get_job(old_key) is not None

        # User moves the event by a day: the old job is removed, a new one
        # appears for the new occurrence, and no duplicate remains.
        event.start_at = datetime(2026, 1, 2, 10, 0, tzinfo=UTC)
        added, removed = reschedule_for_event(scheduler, event, _noop_job, now=now)
        assert (added, removed) == (1, 1)
        assert scheduler.get_job(old_key) is None
        new_key = dedupe_key(event.id, "2026-01-02T10:00:00+00:00", "1h")
        assert scheduler.get_job(new_key) is not None
        assert len(scheduler.get_jobs()) == 1
    finally:
        _shutdown(scheduler)


def test_reschedule_for_event_retimes_same_key() -> None:
    """A changed remind_time_of_day replaces the job (add no-ops on keys)."""
    event = _event(
        id=1,
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        remind_time_of_day="09:00",
    )
    scheduler = _wire_scheduler()
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        reschedule_for_event(scheduler, event, _noop_job, now=now)
        key = dedupe_key(event.id, "2026-01-01T10:00:00+00:00", "1h")
        assert scheduler.get_job(key).trigger.run_date == datetime(
            2026, 1, 1, 9, 0, tzinfo=UTC
        )

        # Same key (same occurrence + offset), new run time -> replaced.
        event.remind_time_of_day = "08:30"
        added, removed = reschedule_for_event(scheduler, event, _noop_job, now=now)
        assert (added, removed) == (1, 0)
        assert scheduler.get_job(key).trigger.run_date == datetime(
            2026, 1, 1, 8, 30, tzinfo=UTC
        )
        assert len(scheduler.get_jobs()) == 1
    finally:
        _shutdown(scheduler)


def test_reschedule_for_event_removes_dropped_offset() -> None:
    """Removing a reminder offset removes its pending job."""
    event = _event(
        id=1,
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        reminder_offsets=["1h", "1d"],
    )
    scheduler = _wire_scheduler()
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        reschedule_for_event(scheduler, event, _noop_job, now=now)
        assert len(scheduler.get_jobs()) == 2

        event.reminder_offsets = ["1h"]
        added, removed = reschedule_for_event(scheduler, event, _noop_job, now=now)
        assert (added, removed) == (0, 1)
        keys = {job.id for job in scheduler.get_jobs()}
        assert keys == {dedupe_key(event.id, "2026-01-01T10:00:00+00:00", "1h")}
    finally:
        _shutdown(scheduler)


def test_reschedule_for_event_archived_clears_jobs() -> None:
    """Archiving an event (via update) removes all its pending jobs."""
    event = _event(id=1, start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    scheduler = _wire_scheduler()
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        reschedule_for_event(scheduler, event, _noop_job, now=now)
        assert len(scheduler.get_jobs()) == 1

        event.status = EventStatus.ARCHIVED
        added, removed = reschedule_for_event(scheduler, event, _noop_job, now=now)
        assert (added, removed) == (0, 1)
        assert scheduler.get_jobs() == []
    finally:
        _shutdown(scheduler)


def test_reschedule_for_event_preserves_drained_job() -> None:
    """A due-now job (drained at startup) survives an unrelated update."""
    event = _event(id=1, start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    scheduler = _wire_scheduler()
    try:
        # The reminder (09:00) was missed (app down): add_reminder_job drains
        # it to fire immediately, i.e. run_date == now — the startup-drain
        # state this test simulates.
        now = datetime(2026, 1, 1, 9, 30, tzinfo=UTC)
        key = _add_job(
            scheduler,
            event.id,
            "2026-01-01T10:00:00+00:00",
            "1h",
            datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
            now=now,
        )
        assert scheduler.get_job(key).trigger.run_date == now

        # An unrelated edit re-plans; the drained job is not dropped even
        # though the fresh plan skips past run times.
        event.title = "Renamed standup"
        added, removed = reschedule_for_event(scheduler, event, _noop_job, now=now)
        assert (added, removed) == (0, 0)
        assert scheduler.get_job(key) is not None
    finally:
        _shutdown(scheduler)


def test_reschedule_for_event_preserves_followups() -> None:
    """Pending snooze/repeat follow-ups survive an event edit."""
    event = _event(id=1, start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    scheduler = _wire_scheduler()
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        reschedule_for_event(scheduler, event, _noop_job, now=now)
        # Simulate a user snooze: a follow-up job with a ~snooze@ marker.
        snooze_key = _add_job(
            scheduler,
            event.id,
            "2026-01-01T10:00:00+00:00~snooze@600",
            "1h",
            datetime(2026, 1, 1, 9, 10, tzinfo=UTC),
        )

        event.title = "Renamed standup"
        added, removed = reschedule_for_event(scheduler, event, _noop_job, now=now)
        assert (added, removed) == (0, 0)
        assert scheduler.get_job(snooze_key) is not None
        assert len(scheduler.get_jobs()) == 2
    finally:
        _shutdown(scheduler)


def test_reschedule_for_event_idempotent() -> None:
    """Re-scheduling an unchanged event is a no-op (dedupe still holds)."""
    event = _event(
        id=1,
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        reminder_offsets=["1h", "1d"],
    )
    scheduler = _wire_scheduler()
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        assert reschedule_for_event(scheduler, event, _noop_job, now=now) == (2, 0)
        assert reschedule_for_event(scheduler, event, _noop_job, now=now) == (0, 0)
        assert len(scheduler.get_jobs()) == 2
    finally:
        _shutdown(scheduler)


def test_reschedule_for_event_tolerates_vanished_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A job firing between the snapshot and its removal doesn't crash re-plans.

    Regression test for the PR #137 review race finding: APScheduler deletes
    fired one-shot jobs itself, so a key returned by ``event_job_keys`` can
    vanish before ``remove_job`` runs. Both removal loops tolerate the
    resulting ``JobLookupError`` exactly like ``remove_event_jobs``.
    """
    event = _event(id=1, start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    scheduler = _wire_scheduler()
    try:
        now = datetime(2025, 12, 1, tzinfo=UTC)
        key = dedupe_key(1, "2026-01-01T10:00:00+00:00", "1h")
        # Prove the phantom key truly has no job behind it.
        with pytest.raises(JobLookupError):
            scheduler.remove_job(key)

        # Re-timed branch: snapshot reports the key with a changed run time,
        # but the job vanished before the pre-add removal.
        monkeypatch.setattr(
            "app.scheduler.event_job_keys",
            lambda *a, **k: {key: datetime(2026, 1, 1, 8, 0, tzinfo=UTC)},
        )
        assert reschedule_for_event(scheduler, event, _noop_job, now=now) == (1, 0)
        assert scheduler.get_job(key) is not None

        # Stale branch: a phantom key absent from the desired plan is dropped
        # without raising even though no such job exists.
        phantom = "1:2026-01-03T10:00:00+00:00:1h"
        monkeypatch.setattr(
            "app.scheduler.event_job_keys",
            lambda *a, **k: {phantom: now + timedelta(days=1)},
        )
        assert reschedule_for_event(scheduler, event, _noop_job, now=now) == (0, 1)
        assert scheduler.get_job(key) is not None  # the real job survived
    finally:
        _shutdown(scheduler)


def test_remove_event_jobs_removes_all_including_followups() -> None:
    """Deleting an event drops its plan jobs and pending follow-ups."""
    scheduler = _wire_scheduler()
    try:
        _add_job(
            scheduler,
            7,
            "2026-01-01T10:00:00+00:00",
            "1h",
            datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
        )
        _add_job(
            scheduler,
            7,
            "2026-01-01T10:00:00+00:00~repeat@1",
            "1h",
            datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        )
        # A job of another event must survive.
        _add_job(
            scheduler,
            8,
            "2026-01-01T10:00:00+00:00",
            "1h",
            datetime(2026, 1, 1, 9, 0, tzinfo=UTC),
        )

        removed = remove_event_jobs(scheduler, 7)
        assert removed == 2
        # Only event 8's job remains.
        assert len(scheduler.get_jobs()) == 1
        assert scheduler.get_job(dedupe_key(8, "2026-01-01T10:00:00+00:00", "1h"))
    finally:
        _shutdown(scheduler)


def test_remove_event_jobs_idempotent() -> None:
    """Removing jobs for an event with none pending is a no-op returning 0."""
    scheduler = _wire_scheduler()
    try:
        assert remove_event_jobs(scheduler, 999) == 0
        assert remove_event_jobs(scheduler, 999) == 0
        assert scheduler.get_jobs() == []
    finally:
        _shutdown(scheduler)
