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


def _optional_env(name: str) -> str | None:
    """Return the env value, or None when unset/blank (no quiet hours)."""
    raw = os.getenv(name)
    if raw is None:
        return None
    stripped = raw.strip()
    return stripped or None


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
    #: Seed the initial events on startup when the events table is empty.
    seed_on_start: bool = field(
        default_factory=lambda: _bool_env("TIMELINE_SEED", True)
    )
    #: IANA timezone used for event parsing/display ("now + tz").
    tz: str = field(default_factory=lambda: os.getenv("TZ", "UTC"))
    #: Locale used for date formatting (e.g. en-US).
    locale: str = field(default_factory=lambda: os.getenv("LOCALE", "en-US"))
    #: Quiet-hours start (HH:MM, 24h) or None when quiet hours are disabled.
    quiet_hours_start: str | None = field(
        default_factory=lambda: _optional_env("QUIET_START")
    )
    #: Quiet-hours end (HH:MM, 24h) or None when quiet hours are disabled.
    quiet_hours_end: str | None = field(
        default_factory=lambda: _optional_env("QUIET_END")
    )

    @property
    def database_url(self) -> str:
        """SQLAlchemy database URL (SQLite, WAL-enabled)."""
        return f"sqlite:///{self.data_dir / self.db_name}"


def get_settings() -> Settings:
    """Build settings from the environment (called once at startup)."""
    return Settings()
