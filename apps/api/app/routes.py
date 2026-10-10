"""HTTP route handlers for the timeline event API (issue #15).

Thin layer: parses/validates request data via the Pydantic schemas, delegates
to the DB-I/O layer (``app.crud``) and the pure summary logic (``app.summary``),
and maps results to response models. No business logic lives here.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Annotated

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from . import crud, occurrences, summary
from .config import Settings, get_settings
from .enums import EventStatus
from .models import DeliveryLog, Event
from .quick_parse import parse_quick_add
from .runtime import RuntimeComponents
from .schemas import (
    DeliveryLogRead,
    EventCreate,
    EventOccurrenceRead,
    EventRead,
    EventUpdate,
    QuickParseRequestPayload,
    QuickParseResponse,
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


def get_runtime(request: Request) -> RuntimeComponents | None:
    """Return the app's runtime components (None before the lifespan ran)."""
    return getattr(request.app.state, "runtime", None)


#: FastAPI dependency alias for the runtime components (may be None in tests
#: or before startup).
RuntimeDep = Annotated[RuntimeComponents | None, Depends(get_runtime)]


def _reminder_engine(
    runtime: RuntimeComponents | None,
) -> tuple[BackgroundScheduler | None, Callable[..., object] | None]:
    """Extract ``(scheduler, job_func)`` when the reminder engine is running.

    Returns ``(None, None)`` when the lifespan hasn't started the runtime or
    the scheduler is disabled, so event writes stay a scheduling no-op.
    """
    if runtime is None or runtime.scheduler is None:
        return None, None
    return runtime.scheduler, runtime.job_func


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
    rt: RuntimeDep,
) -> Event:
    """Create a new event and schedule its reminders (issue #134)."""
    scheduler, job_func = _reminder_engine(rt)
    return crud.create_event(db, payload, scheduler=scheduler, job_func=job_func)


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
    rt: RuntimeDep,
) -> Event:
    """Partially update an existing event and re-plan its reminders."""
    event = crud.get_event(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="event not found"
        )
    scheduler, job_func = _reminder_engine(rt)
    return crud.update_event(db, event, payload, scheduler=scheduler, job_func=job_func)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: SessionDep, rt: RuntimeDep) -> None:
    """Delete an event by id and drop its pending reminders."""
    event = crud.get_event(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="event not found"
        )
    scheduler, _job_func = _reminder_engine(rt)
    crud.delete_event(db, event, scheduler=scheduler)


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


@router.post("/events/quick-parse", response_model=QuickParseResponse)
def quick_parse_event_text(
    payload: QuickParseRequestPayload,
    settings: Annotated[Settings, Depends(get_settings)],
) -> QuickParseResponse:
    """Parse free text into an event draft, deterministically (offline).

    Thin layer over the pure ``quick_parse.parse_quick_add``: no network, no
    key, no 503/502 — the worst case is a today/all-day draft the owner
    corrects on the draft card. ``now``/``tz`` default to the server's clock
    and ``settings.tz``. No DB access — drafts are confirmed before save.
    """
    result = parse_quick_add(
        payload.text,
        payload.now or datetime.now(UTC),
        payload.tz or settings.tz,
    )
    return QuickParseResponse(
        draft=result.draft.model_dump(exclude_none=True),
        has_explicit_date=result.has_explicit_date,
        has_explicit_time=result.has_explicit_time,
    )
