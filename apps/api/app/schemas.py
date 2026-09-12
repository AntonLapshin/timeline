"""Pydantic request/response schemas for the timeline event API.

These schemas mirror the shared event JSON schema v1
(`packages/shared/schemas/event.schema.v1.json`) and the Python enums in
`app/enums.py`, so the wire format stays in one place. They are thin data
shapes: no business logic, no I/O. Field constraints (title length, channel /
priority enums, reminder-offset pattern) enforce the shared schema's validation
rules at the API boundary.
"""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .enums import (
    EventChannel,
    EventPriority,
    EventSource,
    EventStatus,
    EventType,
)

#: Allowed reminder offsets look like "7d", "1d", "2h" (shared schema pattern).
_REMINDER_OFFSET_RE = re.compile(r"^[0-9]+[dhm]$")

#: Default reminder channels per the shared schema (["telegram"]).
_DEFAULT_CHANNELS: list[EventChannel] = [EventChannel.TELEGRAM]


class EventBase(BaseModel):
    """Fields shared by create/update/read event payloads (schema v1)."""

    model_config = ConfigDict(use_enum_values=True)

    title: str = Field(min_length=1, max_length=500)
    description: str = ""
    location_url: str = ""
    tags: list[str] = []
    type: EventType
    start_at: datetime
    end_at: datetime | None = None
    all_day: bool = False
    tz: str = "UTC"
    rrule: str | None = None
    priority: EventPriority = EventPriority.MEDIUM
    channels: list[EventChannel] = Field(default_factory=lambda: _DEFAULT_CHANNELS)
    reminder_offsets: list[str] = []
    remind_time_of_day: str | None = None
    repeat_until_ack: bool = False
    snooze_allowed: bool = True
    email_enabled: bool = False
    email_to: str | None = None
    source: EventSource = EventSource.WEB
    raw_input: str | None = None
    ai_confidence: float | None = None
    status: EventStatus = EventStatus.ACTIVE

    @field_validator("reminder_offsets")
    @classmethod
    def _valid_reminder_offsets(cls, value: list[str]) -> list[str]:
        """Reject reminder offsets that don't match the shared schema pattern."""
        for offset in value:
            if not _REMINDER_OFFSET_RE.match(offset):
                raise ValueError(
                    f"invalid reminder offset {offset!r}; expected e.g. 7d, 1d, 2h"
                )
        return value


class EventCreate(EventBase):
    """Payload for creating a new event."""


class EventUpdate(BaseModel):
    """Partial update payload; every field is optional.

    ``None`` means "leave unchanged" for nullable fields, so a full replacement
    is expressed by sending the value explicitly. We intentionally reuse the
    shared-schema constraints from ``EventBase``.
    """

    model_config = ConfigDict(use_enum_values=True)

    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    location_url: str | None = None
    tags: list[str] | None = None
    type: EventType | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    all_day: bool | None = None
    tz: str | None = None
    rrule: str | None = None
    priority: EventPriority | None = None
    channels: list[EventChannel] | None = None
    reminder_offsets: list[str] | None = None
    remind_time_of_day: str | None = None
    repeat_until_ack: bool | None = None
    snooze_allowed: bool | None = None
    email_enabled: bool | None = None
    email_to: str | None = None
    source: EventSource | None = None
    raw_input: str | None = None
    ai_confidence: float | None = None
    status: EventStatus | None = None

    @field_validator("reminder_offsets")
    @classmethod
    def _valid_reminder_offsets(cls, value: list[str] | None) -> list[str] | None:
        """Reject reminder offsets that don't match the shared schema pattern."""
        if value is None:
            return None
        for offset in value:
            if not _REMINDER_OFFSET_RE.match(offset):
                raise ValueError(
                    f"invalid reminder offset {offset!r}; expected e.g. 7d, 1d, 2h"
                )
        return value


class EventRead(EventBase):
    """A persisted event as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class SummaryResponse(BaseModel):
    """Counts of event occurrences in a month, grouped by priority."""

    month: str
    total: int
    by_priority: dict[str, int]
