"""drop events.ai_confidence

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-10

Drops the ``ai_confidence`` column from ``events``. The deterministic-only
refactor removed all AI extraction, so the column has no writer (and the ORM
model / schemas no longer declare it).
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the AI confidence column (batch mode for SQLite)."""
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("ai_confidence")


def downgrade() -> None:
    """Re-add the AI confidence column."""
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("ai_confidence", sa.Float(), nullable=True))
