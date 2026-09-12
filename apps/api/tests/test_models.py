"""Tests for the domain ORM models (issue #13)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.enums import (
    EventChannel,
    EventPriority,
    EventSource,
    EventStatus,
    EventType,
)
from app.models import DeliveryLog, Event, Reminder, TelegramInbound


@pytest.fixture()
def session(tmp_path: Path) -> Session:
    """A session bound to an in-memory-style temp SQLite DB with all tables."""
    settings = Settings(data_dir=tmp_path, db_name="models.db")
    engine = create_engine_from_settings(settings)
    models.Base.metadata.create_all(engine)
    session_factory: sessionmaker[Session] = make_session_factory(engine)
    with session_factory() as session:
        yield session


def _event(**overrides: object) -> Event:
    """Build a minimal valid Event with defaults for the rest."""
    values: dict[str, object] = {
        "title": "Team standup",
        "type": EventType.ONE_TIME,
        "start_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        "tz": "Europe/Berlin",
        "priority": EventPriority.MEDIUM,
        "source": EventSource.WEB,
        "status": EventStatus.ACTIVE,
    }
    values.update(overrides)
    return Event(**values)


def test_event_defaults(session: Session) -> None:
    """Event picks up schema-aligned defaults when not specified."""
    event = _event()
    session.add(event)
    session.flush()

    assert event.id is not None
    assert event.description == ""
    assert event.location_url == ""
    assert event.tags == []
    assert event.all_day is False
    assert event.rrule is None
    assert event.channels == ["telegram"]
    assert event.reminder_offsets == []
    assert event.remind_time_of_day is None
    assert event.repeat_until_ack is False
    assert event.snooze_allowed is True
    assert event.email_enabled is False
    assert event.email_to is None
    assert event.raw_input is None
    assert event.ai_confidence is None
    assert event.created_at is not None
    assert event.updated_at is not None


def test_event_recurrent_fields(session: Session) -> None:
    """A recurrent event stores its rrule and tags."""
    event = _event(
        type=EventType.RECURRENT,
        rrule="FREQ=WEEKLY;BYDAY=MO",
        tags=["work", "standup"],
        all_day=True,
        priority=EventPriority.CRITICAL,
        source=EventSource.TELEGRAM_TEXT,
        status=EventStatus.DRAFT,
    )
    session.add(event)
    session.flush()

    assert event.type == EventType.RECURRENT
    assert event.rrule == "FREQ=WEEKLY;BYDAY=MO"
    assert event.tags == ["work", "standup"]
    assert event.all_day is True
    assert event.priority == EventPriority.CRITICAL
    assert event.source == EventSource.TELEGRAM_TEXT
    assert event.status == EventStatus.DRAFT


def test_reminder_defaults_and_relationship(session: Session) -> None:
    """Reminder defaults apply and the event back-reference works."""
    event = _event()
    session.add(event)
    session.flush()

    reminder = Reminder(
        event_id=event.id,
        channels=[EventChannel.TELEGRAM.value],
        offsets=["7d", "1d", "2h"],
        quiet_hours_start="22:00",
        quiet_hours_end="08:00",
    )
    session.add(reminder)
    session.flush()

    assert reminder.repeat_until_ack is False
    assert reminder.snooze_allowed is True
    assert reminder.remind_time_of_day is None
    assert reminder.channels == ["telegram"]
    assert reminder.offsets == ["7d", "1d", "2h"]
    assert reminder.quiet_hours_start == "22:00"
    assert reminder.quiet_hours_end == "08:00"

    # Relationship both ways.
    assert reminder.event is event
    assert reminder.event.title == "Team standup"
    assert event.reminders == [reminder]


def test_delivery_log_relationship(session: Session) -> None:
    """DeliveryLog stores delivery metadata and links to its event."""
    event = _event()
    session.add(event)
    session.flush()

    log = DeliveryLog(
        event_id=event.id,
        occurrence_id="2026-01-01T10:00:00",
        offset="2h",
        status="delivered",
        sent_at=datetime(2026, 1, 1, 8, 0, tzinfo=UTC),
    )
    session.add(log)
    session.flush()

    assert log.status == "delivered"
    assert log.offset == "2h"
    assert log.occurrence_id == "2026-01-01T10:00:00"
    assert log.scheduled_at is None
    assert log.error is None
    assert log.event is event
    assert event.delivery_logs == [log]


def test_telegram_inbound_parsed_draft(session: Session) -> None:
    """TelegramInbound stores message metadata and the parsed draft JSON."""
    inbound = TelegramInbound(
        telegram_message_id="msg_42",
        chat_id="123456",
        message_type="voice",
        voice_duration_sec=17,
        file_id="AwAC...",
        parsed_draft={"title": "Dentist", "start_at": "2026-02-01T09:00:00"},
    )
    session.add(inbound)
    session.flush()

    assert inbound.id is not None
    assert inbound.telegram_message_id == "msg_42"
    assert inbound.message_type == "voice"
    assert inbound.voice_duration_sec == 17
    assert inbound.status == "received"
    assert inbound.parsed_draft == {
        "title": "Dentist",
        "start_at": "2026-02-01T09:00:00",
    }


def test_models_match_migration_tables(tmp_path: Path) -> None:
    """The ORM metadata produces the same tables the migration creates."""
    settings = Settings(data_dir=tmp_path, db_name="match.db")
    engine = create_engine_from_settings(settings)
    models.Base.metadata.create_all(engine)
    tables = set(inspect(engine).get_table_names())
    assert {
        "app_config",
        "events",
        "reminders",
        "delivery_logs",
        "telegram_inbound",
    } <= tables

    # FK relationships are declared.
    events_fks = {
        (fk["constrained_columns"][0], fk["referred_table"])
        for fk in inspect(engine).get_foreign_keys("reminders")
    }
    assert ("event_id", "events") in events_fks
