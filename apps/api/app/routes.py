"""HTTP route handlers for the timeline event API (issue #15).

Thin layer: parses/validates request data via the Pydantic schemas, delegates
to the DB-I/O layer (``app.crud``) and the pure summary logic (``app.summary``),
and maps results to response models. No business logic lives here.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from . import crud, occurrences, summary
from .enums import EventStatus
from .models import DeliveryLog, Event
from .schemas import (
    DeliveryLogRead,
    EventCreate,
    EventOccurrenceRead,
    EventRead,
    EventUpdate,
    SummaryResponse,
)

router = APIRouter(prefix="/api", tags=["events"])

#: Strict YYYY-MM month format for the summary endpoint.
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def get_db(request: Request) -> Iterator[Session]:
    """Yield a session from the app's session factory (see create_app)."""
    factory = request.app.state.session_factory
    with factory() as session:
        yield session


#: FastAPI dependency alias for a request-scoped DB session.
SessionDep = Annotated[Session, Depends(get_db)]


def _parse_month(month: str) -> tuple[int, int]:
    """Parse and validate a YYYY-MM month string, returning (year, month)."""
    if not _MONTH_RE.match(month):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month must be in YYYY-MM format",
        )
    year, month_num = (int(part) for part in month.split("-"))
    if not 1 <= month_num <= 12:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month must be between 01 and 12",
        )
    return year, month_num


@router.post(
    "/events",
    response_model=EventRead,
    status_code=status.HTTP_201_CREATED,
)
def create_event(
    payload: EventCreate,
    db: SessionDep,
) -> Event:
    """Create a new event."""
    return crud.create_event(db, payload)


@router.get("/events", response_model=list[EventRead])
def list_events(db: SessionDep) -> list[Event]:
    """List all events ordered by start time."""
    return crud.list_events(db)


@router.get("/events/occurrences", response_model=list[EventOccurrenceRead])
def get_occurrences(
    month: Annotated[str, Query(..., description="Month in YYYY-MM format")],
    db: SessionDep,
) -> list[EventOccurrenceRead]:
    """Return each active event's concrete occurrences in a month.

    Recurrent events contribute one entry per occurrence in the month; one-time
    events contribute a single occurrence. Logic stays in the pure
    ``app.occurrences`` module.
    """
    year, month_num = _parse_month(month)
    events = [e for e in crud.list_events(db) if e.status == EventStatus.ACTIVE]
    return [
        EventOccurrenceRead(
            event_id=o.event_id,
            title=o.title,
            priority=o.priority,
            tag=o.tag,
            rrule=o.rrule,
            start_at=o.start_at,
            all_day=o.all_day,
            tz=o.tz,
            next_occurrence=o.next_occurrence,
        )
        for o in occurrences.occurrences_for_month(events, year, month_num)
    ]


@router.get("/events/{event_id}", response_model=EventRead)
def get_event(event_id: int, db: SessionDep) -> Event:
    """Fetch a single event by id."""
    event = crud.get_event(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="event not found"
        )
    return event


@router.get("/events/{event_id}/deliveries", response_model=list[DeliveryLogRead])
def get_event_deliveries(event_id: int, db: SessionDep) -> list[DeliveryLog]:
    """Return an event's delivery log, most recent first (issue #63)."""
    event = crud.get_event(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="event not found"
        )
    return crud.list_deliveries(db, event_id)


@router.patch("/events/{event_id}", response_model=EventRead)
def update_event(
    event_id: int,
    payload: EventUpdate,
    db: SessionDep,
) -> Event:
    """Partially update an existing event."""
    event = crud.get_event(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="event not found"
        )
    return crud.update_event(db, event, payload)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: SessionDep) -> None:
    """Delete an event by id."""
    event = crud.get_event(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="event not found"
        )
    crud.delete_event(db, event)


@router.get("/summary", response_model=SummaryResponse)
def get_summary(
    month: Annotated[str, Query(..., description="Month in YYYY-MM format")],
    db: SessionDep,
) -> SummaryResponse:
    """Count active event occurrences in a month, grouped by priority."""
    year, month_num = _parse_month(month)
    events = [e for e in crud.list_events(db) if e.status == EventStatus.ACTIVE]
    result = summary.summarize_month(events, year, month_num)
    return SummaryResponse(
        month=result.month,
        total=result.total,
        by_priority=result.by_priority,
    )
