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
    #: Directory for nightly SQLite backups (gitignored, default ./backups).
    backups_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("TIMELINE_BACKUPS_DIR", str(_DEFAULT_DATA_DIR.parent / "backups"))
        )
    )
    #: Number of recent backups to keep when pruning (default 30, ~30 days).
    backup_keep: int = field(
        default_factory=lambda: int(os.getenv("TIMELINE_BACKUP_KEEP", "30"))
    )
    #: Host to bind. Must stay loopback-only (no auth); refuse 0.0.0.0.
    host: str = field(default_factory=lambda: os.getenv("TIMELINE_HOST", "127.0.0.1"))
    #: Port to bind.
    port: int = field(default_factory=lambda: int(os.getenv("TIMELINE_PORT", "8123")))
    #: Enable SQLite WAL mode (durable + concurrent readers).
    wal_enabled: bool = field(default_factory=lambda: _bool_env("TIMELINE_WAL", True))
    #: Log file path (rotated by RotatingFileHandler / logrotate). Empty ⇒ stderr.
    log_file: str | None = field(
        default_factory=lambda: _optional_env("TIMELINE_LOG_FILE")
    )
    #: Max size of a single log file before rotation, in bytes (default 5 MB).
    log_max_bytes: int = field(
        default_factory=lambda: int(os.getenv("TIMELINE_LOG_MAX_BYTES", "5242880"))
    )
    #: Number of rotated log files to keep (default 5).
    log_backup_count: int = field(
        default_factory=lambda: int(os.getenv("TIMELINE_LOG_BACKUP_COUNT", "5"))
    )
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
    #: Telegram bot token (from local .env BOT_TOKEN, never committed).
    telegram_bot_token: str | None = field(
        default_factory=lambda: _optional_env("BOT_TOKEN")
    )
    #: Numeric Telegram user id for the single-user allowlist.
    telegram_user_id: str | None = field(
        default_factory=lambda: _optional_env("TELEGRAM_USER_ID")
    )
    #: Email feature flag (v1 default OFF). When off no email is ever sent,
    #: regardless of event channels (issue #61, M4-T3B).
    email_enabled: bool = field(
        default_factory=lambda: _bool_env("EMAIL_ENABLED", False)
    )
    #: SMTP host for the email sender (local .env only, never committed).
    smtp_host: str | None = field(default_factory=lambda: _optional_env("SMTP_HOST"))
    #: SMTP port (default 587 for STARTTLS).
    smtp_port: int = field(default_factory=lambda: int(os.getenv("SMTP_PORT", "587")))
    #: SMTP username.
    smtp_user: str | None = field(default_factory=lambda: _optional_env("SMTP_USER"))
    #: SMTP password (secret).
    smtp_pass: str | None = field(default_factory=lambda: _optional_env("SMTP_PASS"))
    #: "From" address for reminder emails.
    smtp_from: str | None = field(default_factory=lambda: _optional_env("SMTP_FROM"))
    #: Default "To" address for reminder emails.
    smtp_to: str | None = field(default_factory=lambda: _optional_env("SMTP_TO"))
    #: JoinGonka / OpenAI-compatible base URL for LLM parsing (issue #70).
    llm_base_url: str = field(
        default_factory=lambda: os.getenv(
            "LLM_BASE_URL", "https://gate.joingonka.ai/openai/v1"
        )
    )
    #: LLM model name for parsing (local .env only).
    llm_model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", ""))
    #: LLM API key (local .env only, never committed). Absent ⇒ parse unavailable.
    llm_api_key: str | None = field(
        default_factory=lambda: _optional_env("LLM_API_KEY")
    )
    #: Path to the local voxtype binary used for whisper.cpp transcription
    #: (issue #71). Defaults to ``voxtype`` on PATH; points at the local install
    #: when it lives elsewhere (e.g. the natalies-corner voxtype install).
    stt_voxtype_path: str = field(
        default_factory=lambda: os.getenv("STT_VOXTYPE_PATH", "voxtype")
    )
    #: Local whisper model path for STT. Empty ⇒ let voxtype use its installed
    #: default model (issue #71).
    stt_model_path: str | None = field(
        default_factory=lambda: _optional_env("STT_MODEL_PATH")
    )
    #: Maximum voice-message duration in seconds (2-minute cap, issue #71).
    stt_max_seconds: float = field(
        default_factory=lambda: float(os.getenv("STT_MAX_SECONDS", "120"))
    )

    @property
    def database_url(self) -> str:
        """SQLAlchemy database URL (SQLite, WAL-enabled)."""
        return f"sqlite:///{self.data_dir / self.db_name}"

    @property
    def db_path(self) -> Path:
        """Absolute path to the SQLite database file."""
        return self.data_dir / self.db_name


def get_settings() -> Settings:
    """Build settings from the environment (called once at startup)."""
    return Settings()
