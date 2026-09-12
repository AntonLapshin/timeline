"""SQLAlchemy ORM models for the timeline API (initial M1 skeleton).

Only a minimal set of tables is introduced in the initial migration so the
schema is bootable and Alembic is wired end-to-end. The full domain model
(Event, Reminder, DeliveryLog, TelegramInbound) is fleshed out in later
milestones; the `app_config` table is the natural first table (single local
user, manifest §5).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


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
