"""add domain tables (events, reminders, delivery_logs, telegram_inbound)

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-12

Adds the full domain model tables (Event, Reminder, DeliveryLog, TelegramInbound)
on top of the initial `app_config` table. Enum columns store plain VARCHAR values
matching `packages/shared` so the wire format stays in one place.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the domain tables."""
    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("location_url", sa.String(length=2048), nullable=False, server_default=""),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("tz", sa.String(length=64), nullable=False, server_default="UTC"),
        sa.Column("rrule", sa.String(length=255), nullable=True),
        sa.Column("priority", sa.String(length=16), nullable=False, server_default="medium"),
        sa.Column("channels", sa.JSON(), nullable=False),
        sa.Column("reminder_offsets", sa.JSON(), nullable=False),
        sa.Column("remind_time_of_day", sa.String(length=5), nullable=True),
        sa.Column("repeat_until_ack", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("snooze_allowed", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("email_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("email_to", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=24), nullable=False, server_default="web"),
        sa.Column("raw_input", sa.Text(), nullable=True),
        sa.Column("ai_confidence", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_table(
        "reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channels", sa.JSON(), nullable=False),
        sa.Column("offsets", sa.JSON(), nullable=False),
        sa.Column("remind_time_of_day", sa.String(length=5), nullable=True),
        sa.Column("repeat_until_ack", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("snooze_allowed", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("quiet_hours_start", sa.String(length=5), nullable=True),
        sa.Column("quiet_hours_end", sa.String(length=5), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index("ix_reminders_event_id", "reminders", ["event_id"])
    op.create_table(
        "delivery_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("occurrence_id", sa.String(length=255), nullable=True),
        sa.Column("offset", sa.String(length=16), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="scheduled"),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index("ix_delivery_logs_event_id", "delivery_logs", ["event_id"])
    op.create_table(
        "telegram_inbound",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("telegram_message_id", sa.String(length=64), nullable=True),
        sa.Column("chat_id", sa.String(length=64), nullable=True),
        sa.Column("message_type", sa.String(length=16), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("voice_duration_sec", sa.Integer(), nullable=True),
        sa.Column("file_id", sa.String(length=255), nullable=True),
        sa.Column("parsed_draft", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="received"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_telegram_inbound_telegram_message_id",
        "telegram_inbound",
        ["telegram_message_id"],
        unique=True,
    )


def downgrade() -> None:
    """Drop the domain tables."""
    op.drop_index(
        "ix_telegram_inbound_telegram_message_id", table_name="telegram_inbound"
    )
    op.drop_table("telegram_inbound")
    op.drop_index("ix_delivery_logs_event_id", table_name="delivery_logs")
    op.drop_table("delivery_logs")
    op.drop_index("ix_reminders_event_id", table_name="reminders")
    op.drop_table("reminders")
    op.drop_table("events")
