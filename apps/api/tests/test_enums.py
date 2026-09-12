"""Tests that API enums mirror the shared wire-format constants.

The canonical wire format lives in `packages/shared/src/eventSchema.ts` and
`packages/shared/schemas/event.schema.v1.json`. The API is Python and cannot
import the TS module, so `app/enums.py` mirrors the exact string values. These
tests lock the Python values to the shared constants so the two stay in sync.
"""

from __future__ import annotations

from app.enums import (
    EventChannel,
    EventPriority,
    EventSource,
    EventStatus,
    EventType,
)

# Values mirrored from packages/shared/src/eventSchema.ts (EVENT_*_CONSTANTS).
SHARED_STATUSES = ["draft", "active", "archived"]
SHARED_SOURCES = ["web", "telegram_text", "telegram_voice", "ai"]
SHARED_TYPES = ["one_time", "recurrent"]
SHARED_PRIORITIES = ["critical", "medium", "low"]
SHARED_CHANNELS = ["telegram", "email"]


def _values(enum_cls: type) -> list[str]:
    return [member.value for member in enum_cls]


def test_event_status_matches_shared() -> None:
    assert _values(EventStatus) == SHARED_STATUSES


def test_event_source_matches_shared() -> None:
    assert _values(EventSource) == SHARED_SOURCES


def test_event_type_matches_shared() -> None:
    assert _values(EventType) == SHARED_TYPES


def test_event_priority_matches_shared() -> None:
    assert _values(EventPriority) == SHARED_PRIORITIES


def test_event_channel_matches_shared() -> None:
    assert _values(EventChannel) == SHARED_CHANNELS


def test_enums_are_str_subclasses() -> None:
    """Enums serialize to their plain string values on the wire."""
    assert EventStatus.ACTIVE == "active"
    assert EventStatus.ACTIVE.value == "active"
    assert EventPriority.CRITICAL.value == "critical"
    assert EventType.RECURRENT.value == "recurrent"
    assert EventSource.TELEGRAM_VOICE.value == "telegram_voice"
    assert EventChannel.EMAIL.value == "email"
