"""Application configuration loaded from environment variables.

Secrets and machine-specific values live in a local `.env` file (gitignored).
`.env.example` documents the placeholders. All values have safe defaults so the
app boots out of the box for local development.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# The repository root is two levels up from this module (apps/api/app/config.py).
_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_DATA_DIR = _REPO_ROOT / "data"


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    """Runtime settings for the timeline API."""

    #: Directory where the SQLite database file lives (gitignored).
    data_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("TIMELINE_DATA_DIR", str(_DEFAULT_DATA_DIR))
        )
    )
    #: SQLite database filename (relative to data_dir).
    db_name: str = field(
        default_factory=lambda: os.getenv("TIMELINE_DB_NAME", "timeline.db")
    )
    #: Host to bind. Must stay loopback-only (no auth); refuse 0.0.0.0.
    host: str = field(default_factory=lambda: os.getenv("TIMELINE_HOST", "127.0.0.1"))
    #: Port to bind.
    port: int = field(default_factory=lambda: int(os.getenv("TIMELINE_PORT", "8123")))
    #: Enable SQLite WAL mode (durable + concurrent readers).
    wal_enabled: bool = field(default_factory=lambda: _bool_env("TIMELINE_WAL", True))

    @property
    def database_url(self) -> str:
        """SQLAlchemy database URL (SQLite, WAL-enabled)."""
        return f"sqlite:///{self.data_dir / self.db_name}"


def get_settings() -> Settings:
    """Build settings from the environment (called once at startup)."""
    return Settings()
