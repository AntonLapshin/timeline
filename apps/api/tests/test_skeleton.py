"""Tests for the timeline API skeleton (issue #1)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import Settings
from app.db import create_engine_from_settings
from app.main import create_app


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    """Build isolated settings pointing at a temp data dir."""
    return Settings(data_dir=tmp_path, db_name="test.db")


@pytest.fixture()
def client(settings: Settings) -> TestClient:
    """A TestClient bound to an isolated app instance."""
    return TestClient(create_app(settings))


def test_healthz_returns_ok(client: TestClient) -> None:
    """The /healthz endpoint reports ok when the DB is reachable."""
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_healthz_creates_database_file(settings: Settings) -> None:
    """Hitting /healthz creates the SQLite database under the data dir."""
    client = TestClient(create_app(settings))
    client.get("/healthz")
    assert (settings.data_dir / settings.db_name).exists()


def test_engine_uses_sqlite_wal(settings: Settings) -> None:
    """The engine points at the configured SQLite URL and enables WAL."""
    engine = create_engine_from_settings(settings)
    assert str(engine.url) == f"sqlite:///{settings.data_dir / settings.db_name}"
    with engine.connect() as conn:
        journal_mode = conn.execute(text("PRAGMA journal_mode")).scalar()
    assert journal_mode == "wal"


def test_engine_creates_data_dir(tmp_path: Path) -> None:
    """Creating the engine creates the data directory if missing."""
    missing = tmp_path / "nested" / "data"
    assert not missing.exists()
    create_engine_from_settings(Settings(data_dir=missing, db_name="test.db"))
    assert missing.is_dir()


def test_wal_can_be_disabled(settings: Settings) -> None:
    """When WAL is disabled the journal mode is not wal."""
    settings = Settings(
        data_dir=settings.data_dir,
        db_name="test.db",
        wal_enabled=False,
    )
    engine = create_engine_from_settings(settings)
    with engine.connect() as conn:
        journal_mode = conn.execute(text("PRAGMA journal_mode")).scalar()
    assert journal_mode != "wal"
