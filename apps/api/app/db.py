"""Database engine wiring for the timeline API.

Uses SQLAlchemy 2.0 with a SQLite (WAL) database stored under `./data` (gitignored).
All database I/O lives here (or in models/migrations), never in route handlers.
"""

from __future__ import annotations

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import Settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def _enable_wal(engine: Engine) -> None:
    """Enable SQLite WAL journal mode for the given engine connection."""

    @event.listens_for(engine, "connect")
    def _set_wal(dbapi_connection: object, _record: object) -> None:  # noqa: ANN001
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def create_engine_from_settings(settings: Settings) -> Engine:
    """Create a SQLAlchemy engine bound to the configured SQLite database.

    Ensures the data directory exists and enables WAL mode when configured.
    """
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False},
    )
    if settings.wal_enabled:
        _enable_wal(engine)
    return engine


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Create a configured session factory bound to the given engine."""
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
