"""drop telegram_inbound.voice_duration_sec

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-10

Drops the ``voice_duration_sec`` column from ``telegram_inbound``. The
deterministic-only refactor removed the whole voice/STT pipeline, so the
column has no writer (and the ORM model no longer declares it).
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the voice duration column (batch mode for SQLite)."""
    with op.batch_alter_table("telegram_inbound") as batch_op:
        batch_op.drop_column("voice_duration_sec")


def downgrade() -> None:
    """Re-add the voice duration column."""
    with op.batch_alter_table("telegram_inbound") as batch_op:
        batch_op.add_column(
            sa.Column("voice_duration_sec", sa.Integer(), nullable=True)
        )
