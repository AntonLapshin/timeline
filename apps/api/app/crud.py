"""Database I/O for events (issue #15).

Thin data-access functions over the SQLAlchemy ``Event`` model. They own the
mapping between the API schemas and the ORM, and all persistence happens here
(never in route handlers). No business logic beyond field mapping.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Event
from .schemas import EventCreate, EventUpdate


def create_event(session: Session, payload: EventCreate) -> Event:
    """Persist a new event from a validated create payload."""
    event = Event(**payload.model_dump())
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def list_events(session: Session) -> list[Event]:
    """Return all events ordered by start time."""
    stmt = select(Event).order_by(Event.start_at.asc())
    return list(session.scalars(stmt).all())


def get_event(session: Session, event_id: int) -> Event | None:
    """Fetch a single event by id (None when not found)."""
    return session.get(Event, event_id)


def update_event(session: Session, event: Event, payload: EventUpdate) -> Event:
    """Apply a partial update to an existing event and persist it."""
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(event, field, value)
    session.commit()
    session.refresh(event)
    return event


def delete_event(session: Session, event: Event) -> None:
    """Delete an event and persist the change."""
    session.delete(event)
    session.commit()
