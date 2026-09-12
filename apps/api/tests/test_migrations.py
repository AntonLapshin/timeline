"""Tests for the Alembic migration wiring (issue #1)."""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command
from app.config import Settings


def _alembic_config(data_dir: Path, db_name: str) -> Config:
    """Build an Alembic Config pointed at an isolated data dir."""
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "alembic")
    )
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{data_dir / db_name}")
    return cfg


def test_initial_migration_creates_app_config(tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001
    """Running `alembic upgrade head` creates the app_config table."""
    monkeypatch.setenv("TIMELINE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TIMELINE_DB_NAME", "migrate.db")

    cfg = _alembic_config(tmp_path, "migrate.db")
    command.upgrade(cfg, "head")

    engine = create_engine(f"sqlite:///{tmp_path / 'migrate.db'}")
    tables = inspect(engine).get_table_names()
    assert "app_config" in tables
    assert "alembic_version" in tables

    # The app_config table has the expected columns.
    columns = {c["name"] for c in inspect(engine).get_columns("app_config")}
    assert {
        "id",
        "tz",
        "quiet_hours_start",
        "quiet_hours_end",
        "telegram_user_id",
        "default_remind_time",
        "created_at",
        "updated_at",
    } <= columns


def test_migration_uses_settings_database_url(tmp_path: Path) -> None:
    """Settings.database_url points at the configured data dir + db name."""
    settings = Settings(data_dir=tmp_path, db_name="migrate.db")
    assert settings.database_url == f"sqlite:///{tmp_path / 'migrate.db'}"
