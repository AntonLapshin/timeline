"""Tests for app.crud with the reminder scheduler wired (issue #134, M10-T1).

Covers the CRUD-level half of the runtime scheduling fix: create/update/
delete keep an event's pending reminder jobs in sync with its plan when a
running scheduler is passed in — and stay a no-op when it isn't (scheduler
disabled). No live Telegram, no network: a real APScheduler over a throwaway
SQLite jobstore and a no-op job function.
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session, sessionmaker

from app import crud, models
from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.scheduler import build_scheduler, event_job_keys
from app.schemas import EventCreate, EventUpdate


def _noop_job(*args: object, **kwargs: object) -> object:
    """A placeholder job that accepts the scheduler's kwargs and does nothing."""
    return None


@pytest.fixture()
def session_factory(tmp_path: Path) -> sessionmaker[Session]:
    """A session factory over an isolated temp DB."""
    settings = Settings(data_dir=tmp_path, db_name="crud.db")
    engine = create_engine_from_settings(settings)
    models.Base.metadata.create_all(engine)
    return make_session_factory(engine)


def _scheduler(tmp_path: Path) -> BackgroundScheduler:
    """A throwaway scheduler over its own jobstore (never started)."""
    return build_scheduler(
        Settings(data_dir=tmp_path, db_name=f"crud-jobs-{id(object())}.db")
    )


def _shutdown(scheduler: BackgroundScheduler) -> None:
    """Tear down a scheduler that may never have been started."""
    with contextlib.suppress(Exception):  # noqa: BLE001 - already stopped is fine
        scheduler.shutdown(wait=False)


def _payload(**overrides: object) -> EventCreate:
    """A valid create payload for an event ~30 days out."""
    values: dict[str, object] = {
        "title": "Dentist",
        "type": "one_time",
        "start_at": datetime.now(UTC).replace(microsecond=0) + timedelta(days=30),
        "tz": "UTC",
        "priority": "medium",
        "source": "web",
        "status": "active",
        "reminder_offsets": ["1h"],
    }
    values.update(overrides)
    return EventCreate(**values)


def test_create_event_schedules_reminders(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """Creating an event with a running scheduler schedules its jobs (#133)."""
    scheduler = build_scheduler(
        Settings(data_dir=tmp_path, db_name=f"crud-sched-{id(object())}.db")
    )
    try:
        with session_factory() as session:
            event = crud.create_event(
                session, _payload(), scheduler=scheduler, job_func=_noop_job
            )
        assert len(event_job_keys(scheduler, event.id)) == 1
    finally:
        _shutdown(scheduler)


def test_create_event_without_scheduler_is_a_noop(
    session_factory: sessionmaker[Session],
) -> None:
    """Without a scheduler (disabled), creation works and schedules nothing."""
    with session_factory() as session:
        event = crud.create_event(session, _payload())
    assert event.id is not None
    assert event.status == "active"


def test_update_event_replans_jobs(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """Updating an event re-plans its jobs to match the new schedule."""
    scheduler = build_scheduler(
        Settings(data_dir=tmp_path, db_name=f"crud-sched-{id(object())}.db")
    )
    try:
        with session_factory() as session:
            event = crud.create_event(
                session, _payload(), scheduler=scheduler, job_func=_noop_job
            )
            event_id = event.id
            old_start = event.start_at
            assert len(event_job_keys(scheduler, event_id)) == 1

            # Move the event a day later: old job removed, new one added.
            updated = crud.update_event(
                session,
                event,
                EventUpdate(start_at=old_start + timedelta(days=1)),
                scheduler=scheduler,
                job_func=_noop_job,
            )
        keys = event_job_keys(scheduler, event_id)
        assert len(keys) == 1
        # The remaining job belongs to the new occurrence.
        (key,) = keys
        assert key.startswith(f"{event_id}:")
        assert updated.start_at == old_start + timedelta(days=1)
    finally:
        _shutdown(scheduler)


def test_update_event_without_scheduler_is_a_noop(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """Updating without a scheduler persists the change and doesn't crash."""
    with session_factory() as session:
        event = crud.create_event(session, _payload())
        updated = crud.update_event(session, event, EventUpdate(title="Renamed"))
        assert updated.title == "Renamed"


def test_delete_event_removes_jobs(
    tmp_path: Path, session_factory: sessionmaker[Session]
) -> None:
    """Deleting an event removes its pending reminder jobs."""
    scheduler = build_scheduler(
        Settings(data_dir=tmp_path, db_name=f"crud-sched-{id(object())}.db")
    )
    try:
        with session_factory() as session:
            event = crud.create_event(
                session, _payload(), scheduler=scheduler, job_func=_noop_job
            )
            event_id = event.id
            assert len(event_job_keys(scheduler, event_id)) == 1

            crud.delete_event(session, event, scheduler=scheduler)
        assert event_job_keys(scheduler, event_id) == {}
        assert scheduler.get_jobs() == []
    finally:
        _shutdown(scheduler)


def test_delete_event_without_scheduler_is_a_noop(
    session_factory: sessionmaker[Session],
) -> None:
    """Deleting without a scheduler still deletes (no crash)."""
    with session_factory() as session:
        event = crud.create_event(session, _payload())
        event_id = event.id
        crud.delete_event(session, event)
        assert crud.get_event(session, event_id) is None
