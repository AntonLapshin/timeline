"""SQLAlchemy ORM models for the timeline API domain (issue #13).

Full domain model: `AppConfig` (single-row local config), `Event` (one-time /
recurrent), `Reminder` (per-event reminder config), `DeliveryLog` (reminder
delivery audit trail) and `TelegramInbound` (inbound Telegram message/draft).
Enums mirror `packages/shared` (see `app/enums.py`) so the wire format stays in
one place. All tables are created by Alembic migrations on the SQLite (WAL)
database.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .enums import EventChannel, EventPriority, EventSource, EventStatus, EventType


def _utcnow() -> datetime:
    """Return the current UTC time (timezone-aware)."""
    return datetime.now(UTC)


class AppConfig(Base):
    """Single-row local configuration (id always 1) per manifest §5."""

    __tablename__ = "app_config"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    tz: Mapped[str] = mapped_column(String(64), default="UTC")
    quiet_hours_start: Mapped[str | None] = mapped_column(String(5), nullable=True)
    quiet_hours_end: Mapped[str | None] = mapped_column(String(5), nullable=True)
    telegram_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    default_remind_time: Mapped[str] = mapped_column(String(5), default="09:00")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=_utcnow,
    )


class Event(Base):
    """A timeline event (one-time or recurrent), per the shared event schema.

    Field names and enum values mirror `packages/shared/schemas/event.schema.v1.json`
    so the wire format stays in one place.
    """

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    location_url: Mapped[str] = mapped_column(String(2048), default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    type: Mapped[EventType] = mapped_column(
        Enum(
            EventType,
            native_enum=False,
            length=16,
            values_callable=lambda e: [v.value for v in e],
        ),
    )
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    tz: Mapped[str] = mapped_column(String(64), default="UTC")
    rrule: Mapped[str | None] = mapped_column(String(255), nullable=True)
    priority: Mapped[EventPriority] = mapped_column(
        Enum(
            EventPriority,
            native_enum=False,
            length=16,
            values_callable=lambda e: [v.value for v in e],
        ),
        default=EventPriority.MEDIUM,
    )
    channels: Mapped[list[EventChannel]] = mapped_column(
        JSON, default=lambda: [EventChannel.TELEGRAM.value]
    )
    reminder_offsets: Mapped[list[str]] = mapped_column(JSON, default=list)
    remind_time_of_day: Mapped[str | None] = mapped_column(String(5), nullable=True)
    repeat_until_ack: Mapped[bool] = mapped_column(Boolean, default=False)
    snooze_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    email_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    email_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[EventSource] = mapped_column(
        Enum(
            EventSource,
            native_enum=False,
            length=24,
            values_callable=lambda e: [v.value for v in e],
        ),
        default=EventSource.WEB,
    )
    raw_input: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[EventStatus] = mapped_column(
        Enum(
            EventStatus,
            native_enum=False,
            length=16,
            values_callable=lambda e: [v.value for v in e],
        ),
        default=EventStatus.ACTIVE,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=_utcnow,
    )

    reminders: Mapped[list[Reminder]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )
    delivery_logs: Mapped[list[DeliveryLog]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


class Reminder(Base):
    """Per-event reminder configuration (manifest §5, M4)."""

    __tablename__ = "reminders"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    channels: Mapped[list[EventChannel]] = mapped_column(
        JSON, default=lambda: [EventChannel.TELEGRAM.value]
    )
    offsets: Mapped[list[str]] = mapped_column(JSON, default=list)
    remind_time_of_day: Mapped[str | None] = mapped_column(String(5), nullable=True)
    repeat_until_ack: Mapped[bool] = mapped_column(Boolean, default=False)
    snooze_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    quiet_hours_start: Mapped[str | None] = mapped_column(String(5), nullable=True)
    quiet_hours_end: Mapped[str | None] = mapped_column(String(5), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=_utcnow,
    )

    event: Mapped[Event] = relationship(back_populates="reminders")


class DeliveryLog(Base):
    """Audit trail for reminder deliveries (manifest §5, M4)."""

    __tablename__ = "delivery_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    occurrence_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    offset: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="scheduled")
    scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=_utcnow,
    )

    event: Mapped[Event] = relationship(back_populates="delivery_logs")


class TelegramInbound(Base):
    """Inbound Telegram message (text/voice) and its parsed draft (M5)."""

    __tablename__ = "telegram_inbound"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_message_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True
    )
    chat_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    message_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    voice_duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    parsed_draft: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="received")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=_utcnow,
    )
