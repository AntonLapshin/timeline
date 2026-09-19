"""Database I/O for events (issue #15).

Thin data-access functions over the SQLAlchemy ``Event`` model. They own the
mapping between the API schemas and the ORM, and all persistence happens here
(never in route handlers). No business logic beyond field mapping.

When a running reminder scheduler is passed in (issue #134), create/update/
delete also keep the event's pending reminder jobs in sync with its plan —
see ``app.scheduler.reschedule_for_event``.
"""

from __future__ import annotations

from collections.abc import Callable

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import DeliveryLog, Event
from .scheduler import remove_event_jobs, reschedule_for_event
from .schemas import EventCreate, EventUpdate


def _reschedule_event(
    scheduler: BackgroundScheduler | None,
    event: Event,
    job_func: Callable[..., object] | None,
) -> None:
    """Re-plan one event's reminder jobs after a committed write (thin wiring).

    No-op when the reminder engine isn't running (no scheduler or no job
    function), so CRUD works identically with the scheduler disabled.
    """
    if scheduler is None or job_func is None:
        return
    reschedule_for_event(scheduler, event, job_func)


def create_event(
    session: Session,
    payload: EventCreate,
    *,
    scheduler: BackgroundScheduler | None = None,
    job_func: Callable[..., object] | None = None,
) -> Event:
    """Persist a new event from a validated create payload.

    When a running scheduler is supplied, its reminder jobs are scheduled
    immediately (issue #133: runtime-created events used to get zero jobs
    until the next restart).
    """
    event = Event(**payload.model_dump())
    session.add(event)
    session.commit()
    session.refresh(event)
    _reschedule_event(scheduler, event, job_func)
    return event


def list_events(session: Session) -> list[Event]:
    """Return all events ordered by start time."""
    stmt = select(Event).order_by(Event.start_at.asc())
    return list(session.scalars(stmt).all())


def get_event(session: Session, event_id: int) -> Event | None:
    """Fetch a single event by id (None when not found)."""
    return session.get(Event, event_id)


def update_event(
    session: Session,
    event: Event,
    payload: EventUpdate,
    *,
    scheduler: BackgroundScheduler | None = None,
    job_func: Callable[..., object] | None = None,
) -> Event:
    """Apply a partial update to an existing event and persist it.

    When a running scheduler is supplied, the event's reminder jobs are
    re-planned to match the new schedule (stale jobs removed, new ones added;
    a no-op when the plan didn't change).
    """
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(event, field, value)
    session.commit()
    session.refresh(event)
    _reschedule_event(scheduler, event, job_func)
    return event


def delete_event(
    session: Session,
    event: Event,
    *,
    scheduler: BackgroundScheduler | None = None,
) -> None:
    """Delete an event and persist the change.

    When a running scheduler is supplied, the event's pending reminder jobs
    (including repeat/snooze follow-ups) are removed so a deleted event can't
    fire reminders.
    """
    event_id = event.id  # capture before the instance is expired by commit
    session.delete(event)
    session.commit()
    if scheduler is not None:
        remove_event_jobs(scheduler, event_id)


def list_deliveries(session: Session, event_id: int) -> list[DeliveryLog]:
    """Return an event's delivery-log rows, most recent first."""
    stmt = (
        select(DeliveryLog)
        .where(DeliveryLog.event_id == event_id)
        .order_by(DeliveryLog.created_at.desc())
    )
    return list(session.scalars(stmt).all())
