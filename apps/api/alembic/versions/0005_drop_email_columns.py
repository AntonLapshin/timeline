"""drop events email columns

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-10

Drops the ``email_enabled`` / ``email_to`` columns from ``events``. The email
reminder channel was removed entirely (Telegram-only delivery), so the columns
have no writer (and the ORM model / schemas no longer declare them).
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the email columns (batch mode for SQLite)."""
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("email_to")
        batch_op.drop_column("email_enabled")


def downgrade() -> None:
    """Re-add the email columns."""
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(
            sa.Column(
                "email_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        batch_op.add_column(sa.Column("email_to", sa.String(length=255), nullable=True))
