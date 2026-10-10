"""Seed data for the timeline API (issue #15).

Provides a small set of representative events — the HRA quarterly obligation,
a one-time 'series next June' event, and a check-up — so a fresh local install
shows meaningful data. ``build_seed_events`` is pure (given a base date it
returns the event payloads as plain dicts); ``seed_if_empty`` is the DB-I/O
entry point that inserts them idempotently (only when the events table is
empty). Seeding happens on first run via the app lifespan and/or the
``python -m app.seed`` command.

Seeding is strictly first-run-only: ``ensure_seeded_once`` records the seeding
decision in a ``<db_name>.seeded`` sentinel file next to the SQLite database,
so deleting every event and restarting the app keeps the database empty
instead of resurrecting the sample events. The sentinel is per-database (it
embeds the configured ``db_name``), so switching to a new ``TIMELINE_DB_NAME``
seeds the fresh database once.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .enums import EventPriority, EventSource, EventStatus, EventType
from .models import Event

if TYPE_CHECKING:
    from .config import Settings


def build_seed_events(base: date) -> list[dict[str, object]]:
    """Return the seed event payloads (plain dicts) anchored to ``base``.

    ``base`` is the reference "today" used to place the events so they are
    visible and correct relative to the install date:
      - HRA quarterly starts the first of ``base``'s month and recurs every 3
        months (medium priority);
      - 'series next June' is a one-time event in June of the following year
        (low priority);
      - a check-up one-time event ~30 days out (medium priority).
    """
    hra_start = datetime(base.year, base.month, 1, 9, 0, tzinfo=UTC)
    series_start = datetime(base.year + 1, 6, 1, 18, 0, tzinfo=UTC)
    checkup_start = datetime(
        base.year, base.month, base.day, 10, 0, tzinfo=UTC
    ) + timedelta(days=30)

    return [
        {
            "title": "Pay HRA (quarterly)",
            "description": "Quarterly HRA payment obligation.",
            "tags": ["finance"],
            "type": EventType.RECURRENT,
            "start_at": hra_start,
            "tz": "UTC",
            "rrule": "FREQ=MONTHLY;INTERVAL=3",
            "priority": EventPriority.MEDIUM,
            "channels": ["telegram"],
            "reminder_offsets": ["7d", "1d"],
            "source": EventSource.WEB,
            "status": EventStatus.ACTIVE,
        },
        {
            "title": "Series season 2 (next June)",
            "description": "One-time 'series next June' event.",
            "tags": ["series"],
            "type": EventType.ONE_TIME,
            "start_at": series_start,
            "tz": "UTC",
            "rrule": None,
            "priority": EventPriority.LOW,
            "channels": ["telegram"],
            "reminder_offsets": [],
            "source": EventSource.WEB,
            "status": EventStatus.ACTIVE,
        },
        {
            "title": "Annual check-up",
            "description": "Routine annual health check-up.",
            "tags": ["health"],
            "type": EventType.ONE_TIME,
            "start_at": checkup_start,
            "tz": "UTC",
            "rrule": None,
            "priority": EventPriority.MEDIUM,
            "channels": ["telegram"],
            "reminder_offsets": ["1d"],
            "source": EventSource.WEB,
            "status": EventStatus.ACTIVE,
        },
    ]


def seed_if_empty(session: Session, base: date | None = None) -> int:
    """Insert seed events if the events table is empty. Returns count inserted.

    Idempotent: re-running with existing events does nothing. ``base`` defaults
    to today and anchors the seed event dates.

    This is a low-level primitive: it cannot tell a fresh database from one
    the user deliberately emptied. App startup must use ``ensure_seeded_once``
    instead so ``restart`` never resurrects deleted events.
    """
    count = session.scalar(select(func.count()).select_from(Event))
    if count and count > 0:
        return 0
    base = base or date.today()
    events = [Event(**payload) for payload in build_seed_events(base)]
    session.add_all(events)
    session.commit()
    return len(events)


def sentinel_path_for(settings: Settings) -> Path:
    """Return the seed-decision sentinel path for the configured database.

    The sentinel lives next to the SQLite file and embeds the db filename, so
    each database is seeded at most once while a new ``TIMELINE_DB_NAME``
    still gets its first-run seeds.
    """
    return settings.data_dir / f"{settings.db_name}.seeded"


def ensure_seeded_once(
    session: Session, settings: Settings, base: date | None = None
) -> int:
    """Seed the database at most once per database file. Returns count inserted.

    - When ``settings.seed_on_start`` is off, does nothing (no sentinel).
    - When the sentinel exists, does nothing (a previous boot already made
      the seeding decision — an empty events table means the user deleted
      everything, and it stays empty across restarts).
    - Otherwise this is the first boot with this database: seed when empty,
      then write the sentinel so later restarts never reseed.

    The sentinel is written even when the table already holds rows (upgrade
    path for databases created before the sentinel existed), and when the
    fresh database is already non-empty.
    """
    if not settings.seed_on_start:
        return 0
    sentinel = sentinel_path_for(settings)
    if sentinel.exists():
        return 0
    count = seed_if_empty(session, base=base)
    try:
        sentinel.parent.mkdir(parents=True, exist_ok=True)
        sentinel.touch(exist_ok=True)
    except OSError:
        # Seeding already committed; a missing sentinel only means the next
        # boot re-evaluates (seed_if_empty stays idempotent on non-empty DBs).
        pass
    return count


def main() -> None:
    """Seed the configured database from the command line.

    Usage: ``python -m app.seed`` (run from apps/api). Creates any missing
    tables, then seeds the initial events if the events table is empty.
    """
    from .config import get_settings
    from .db import Base, create_engine_from_settings, make_session_factory

    settings = get_settings()
    engine = create_engine_from_settings(settings)
    Base.metadata.create_all(engine)
    factory = make_session_factory(engine)
    with factory() as session:
        count = seed_if_empty(session)
    print(f"Seeded {count} event(s) into {settings.database_url}")


if __name__ == "__main__":
    main()
