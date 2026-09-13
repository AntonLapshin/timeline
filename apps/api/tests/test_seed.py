"""Tests for the seed data (issue #15).

Covers the pure ``build_seed_events`` factory (the three expected events and
their recurrence/priority properties) and the idempotent ``seed_if_empty``
DB-I/O entry point, plus first-run seeding through the app lifespan.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.main import create_app
from app.models import Event
from app.seed import build_seed_events, seed_if_empty


def _seed_by_title(title: str) -> dict[str, object]:
    """Return the seed payload with the given title."""
    return next(e for e in build_seed_events(date(2026, 9, 1)) if e["title"] == title)


def test_build_seed_events_returns_three_events() -> None:
    """The seed factory returns the three expected events."""
    events = build_seed_events(date(2026, 9, 1))
    assert len(events) == 3
    titles = {e["title"] for e in events}
    assert titles == {
        "Pay HRA (quarterly)",
        "Series season 2 (next June)",
        "Annual check-up",
    }


def test_hra_quarterly_event_is_recurrent() -> None:
    """The HRA event recurs quarterly (every 3 months) at medium priority."""
    hra = _seed_by_title("Pay HRA (quarterly)")
    assert hra["type"] == "recurrent"
    assert hra["rrule"] == "FREQ=MONTHLY;INTERVAL=3"
    assert hra["priority"] == "medium"
    assert hra["status"] == "active"
    assert hra["reminder_offsets"] == ["7d", "1d"]


def test_series_next_june_is_one_time() -> None:
    """The 'series next June' event is a one-time event in June next year."""
    series = _seed_by_title("Series season 2 (next June)")
    assert series["type"] == "one_time"
    assert series["rrule"] is None
    assert series["priority"] == "low"
    assert series["start_at"] == datetime(2027, 6, 1, 18, 0, tzinfo=UTC)


def test_checkup_is_one_time_medium() -> None:
    """The check-up is a one-time medium-priority event ~30 days out."""
    checkup = _seed_by_title("Annual check-up")
    assert checkup["type"] == "one_time"
    assert checkup["priority"] == "medium"
    assert checkup["start_at"] == datetime(2026, 10, 1, 10, 0, tzinfo=UTC)


@pytest.fixture()
def session(tmp_path: Path) -> Session:
    """An isolated session with all tables created."""
    settings = Settings(data_dir=tmp_path, db_name="seed.db")
    engine = create_engine_from_settings(settings)
    from app import models

    models.Base.metadata.create_all(engine)
    factory: sessionmaker[Session] = make_session_factory(engine)
    with factory() as session:
        yield session


def test_seed_if_empty_inserts_three(session: Session) -> None:
    """Seeding an empty DB inserts the three seed events."""
    count = seed_if_empty(session, base=date(2026, 9, 1))
    assert count == 3
    events = session.query(Event).all()
    assert len(events) == 3


def test_seed_if_empty_is_idempotent(session: Session) -> None:
    """Seeding twice does not duplicate events."""
    seed_if_empty(session, base=date(2026, 9, 1))
    second = seed_if_empty(session, base=date(2026, 9, 1))
    assert second == 0
    assert session.query(Event).count() == 3


def test_seed_events_are_visible_and_correct(session: Session) -> None:
    """Seeded events persist with the expected recurrence/priority values."""
    seed_if_empty(session, base=date(2026, 9, 1))
    hra = session.query(Event).filter(Event.title == "Pay HRA (quarterly)").one()
    assert hra.rrule == "FREQ=MONTHLY;INTERVAL=3"
    assert hra.priority.value == "medium"
    assert hra.status.value == "active"


def test_lifespan_seeds_on_first_run(tmp_path: Path) -> None:
    """Starting the app seeds the database on first run."""
    settings = Settings(data_dir=tmp_path, db_name="lifespan.db")
    with TestClient(create_app(settings)) as client:
        resp = client.get("/api/events")
        assert resp.status_code == 200
        titles = {e["title"] for e in resp.json()}
        assert "Pay HRA (quarterly)" in titles
        assert "Annual check-up" in titles


def test_lifespan_does_not_seed_when_disabled(tmp_path: Path) -> None:
    """Disabling seed_on_start leaves the events table empty."""
    settings = Settings(data_dir=tmp_path, db_name="noseed.db", seed_on_start=False)
    with TestClient(create_app(settings)) as client:
        resp = client.get("/api/events")
        assert resp.json() == []
