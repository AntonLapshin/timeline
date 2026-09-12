"""Enums for the timeline API, mirroring the shared wire format.

The canonical wire format lives in `packages/shared` (TypeScript):
`packages/shared/src/eventSchema.ts` and
`packages/shared/schemas/event.schema.v1.json`. The API is Python, so it cannot
import the TS module directly; these enums mirror the exact string values so the
web app and the API agree on the wire format in one place. A test asserts the
values stay in sync with the shared TS constants.
"""

from __future__ import annotations

from enum import StrEnum


class EventStatus(StrEnum):
    """Lifecycle status of an event (shared EventStatus)."""

    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class EventSource(StrEnum):
    """How an event was captured (shared EventSource)."""

    WEB = "web"
    TELEGRAM_TEXT = "telegram_text"
    TELEGRAM_VOICE = "telegram_voice"
    AI = "ai"


class EventType(StrEnum):
    """Whether the event recurs (shared EventType)."""

    ONE_TIME = "one_time"
    RECURRENT = "recurrent"


class EventPriority(StrEnum):
    """Reminder priority level (shared EventPriority)."""

    CRITICAL = "critical"
    MEDIUM = "medium"
    LOW = "low"


class EventChannel(StrEnum):
    """Reminder delivery channels (shared EventChannel)."""

    TELEGRAM = "telegram"
    EMAIL = "email"
