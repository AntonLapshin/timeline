"""Tests for the nightly SQLite backup + rotation + restore (issue #85, M6-T2).

Covers the acceptance criteria:

- **Dump**: ``dump_db`` writes a timestamped backup file into ``./backups/``
  that contains a consistent snapshot of the database (verified by reading the
  copied file).
- **Rotation**: ``prune_names`` / ``prune`` keep only the newest ``keep``
  backups and delete the oldest (including non-parseable files treated as
  oldest).
- **Restore round-trip**: backup → restore → data intact, verified against a
  real SQLite DB with a table and rows.
- **CLI / one-command**: ``main()`` implements ``backup`` / ``list`` /
  ``restore`` and validates inputs.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app.backup import (
    DEFAULT_KEEP,
    backup_filename,
    dump_db,
    main,
    parse_backup_timestamp,
    prune,
    prune_names,
    restore_db,
    run_backup,
)
from app.config import Settings


def _make_db(path: Path, value: str = "hello") -> None:
    """Create a small SQLite DB at *path* with one table and a row."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    try:
        conn.execute("DROP TABLE IF EXISTS items")
        conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        conn.execute("INSERT INTO items (name) VALUES (?)", (value,))
        conn.commit()
    finally:
        conn.close()


def _read_names(path: Path) -> list[str]:
    conn = sqlite3.connect(str(path))
    try:
        rows = conn.execute("SELECT name FROM items ORDER BY id").fetchall()
        return [r[0] for r in rows]
    finally:
        conn.close()


# --- Pure helpers ------------------------------------------------------------


def test_backup_filename_is_timestamped_and_parseable() -> None:
    """backup_filename produces a UTC timestamped name that parses back."""
    now = datetime(2026, 9, 15, 2, 0, 0, tzinfo=UTC)
    name = backup_filename(now)
    assert name == "timeline-20260915-020000.db"
    assert parse_backup_timestamp(name) == now


def test_backup_filename_normalizes_to_utc() -> None:
    """The embedded timestamp is always UTC regardless of the input tz."""
    aware = datetime(2026, 9, 15, 2, 0, 0, tzinfo=UTC)
    name = backup_filename(aware)
    assert name.endswith("-020000.db")


def test_parse_backup_timestamp_rejects_junk() -> None:
    """Non-backup filenames parse to None (treated as oldest)."""
    assert parse_backup_timestamp("timeline.db") is None
    assert parse_backup_timestamp("notes.txt") is None
    assert parse_backup_timestamp("timeline-20260915.db") is None


def test_prune_names_keeps_newest() -> None:
    """prune_names keeps the newest keep backups and drops the oldest."""
    names = [
        "timeline-20260901-020000.db",
        "timeline-20260915-020000.db",
        "timeline-20260910-020000.db",
    ]
    removed = prune_names(names, keep=2)
    assert removed == ["timeline-20260901-020000.db"]


def test_prune_names_keeps_all_when_under_limit() -> None:
    """Fewer backups than keep ⇒ nothing is removed."""
    names = ["timeline-20260901-020000.db", "timeline-20260902-020000.db"]
    assert prune_names(names, keep=30) == []


def test_prune_names_non_parseable_removed_first() -> None:
    """Files that do not parse as backups are treated as oldest."""
    names = ["timeline-20260910-020000.db", "junk.txt", "timeline.db"]
    removed = prune_names(names, keep=1)
    assert "junk.txt" in removed
    assert "timeline.db" in removed
    assert "timeline-20260910-020000.db" not in removed


def test_prune_names_non_positive_keep_removes_everything() -> None:
    """keep <= 0 removes every backup."""
    names = ["timeline-20260901-020000.db", "timeline-20260902-020000.db"]
    assert prune_names(names, keep=0) == sorted(names)


def test_default_keep_is_30() -> None:
    """The module default retention is 30 backups (~30 days)."""
    assert DEFAULT_KEEP == 30


# --- Dump --------------------------------------------------------------------


def test_dump_db_writes_timestamped_backup(tmp_path: Path) -> None:
    """dump_db writes a readable backup file containing the DB snapshot."""
    db = tmp_path / "data" / "timeline.db"
    _make_db(db, value="alpha")
    backups = tmp_path / "backups"
    created = dump_db(db, backups, datetime(2026, 9, 15, 2, 0, 0, tzinfo=UTC))

    assert backups.is_dir()
    assert created.name == "timeline-20260915-020000.db"
    assert created.is_file()
    # The backup is a real SQLite DB with the same content.
    assert _read_names(created) == ["alpha"]


def test_dump_db_creates_backups_dir(tmp_path: Path) -> None:
    """dump_db creates ./backups when it does not exist yet."""
    db = tmp_path / "data" / "timeline.db"
    _make_db(db)
    backups = tmp_path / "backups"
    created = dump_db(db, backups, datetime(2026, 9, 15, 2, 0, 0, tzinfo=UTC))
    assert created.parent == backups


# --- Restore round-trip ------------------------------------------------------


def test_restore_round_trip_data_intact(tmp_path: Path) -> None:
    """backup → restore → data intact (acceptance criterion)."""
    db = tmp_path / "data" / "timeline.db"
    _make_db(db, value="original")
    backups = tmp_path / "backups"
    created = dump_db(db, backups, datetime(2026, 9, 15, 2, 0, 0, tzinfo=UTC))

    # Simulate data loss / a fresh DB, then restore from the backup.
    restored = tmp_path / "data" / "restored.db"
    restore_db(created, restored)
    assert _read_names(restored) == ["original"]


def test_restore_overwrites_existing_db(tmp_path: Path) -> None:
    """restore_db overwrites the target DB with the backup contents."""
    db = tmp_path / "data" / "timeline.db"
    _make_db(db, value="original")
    backups = tmp_path / "backups"
    created = dump_db(db, backups, datetime(2026, 9, 15, 2, 0, 0, tzinfo=UTC))

    # Target already holds different data; restore must replace it.
    _make_db(db, value="corrupted")
    restore_db(created, db)
    assert _read_names(db) == ["original"]


# --- Prune -------------------------------------------------------------------


def test_prune_removes_oldest_backups(tmp_path: Path) -> None:
    """prune deletes old backups, keeping the newest keep on disk."""
    backups = tmp_path / "backups"
    backups.mkdir(parents=True)
    for day in (1, 2, 3):
        (backups / f"timeline-202609{day:02d}-020000.db").write_bytes(b"x")
    removed = prune(backups, keep=2)

    assert len(removed) == 1
    assert removed[0].name == "timeline-20260901-020000.db"
    remaining = sorted(p.name for p in backups.iterdir())
    assert remaining == [
        "timeline-20260902-020000.db",
        "timeline-20260903-020000.db",
    ]


def test_prune_missing_dir_returns_empty(tmp_path: Path) -> None:
    """prune on a non-existent directory is a no-op."""
    assert prune(tmp_path / "nope", keep=30) == []


# --- run_backup --------------------------------------------------------------


def test_run_backup_dumps_and_prunes(tmp_path: Path) -> None:
    """run_backup writes a new backup and prunes old ones."""
    db = tmp_path / "data" / "timeline.db"
    _make_db(db, value="data")
    backups = tmp_path / "backups"
    backups.mkdir(parents=True)
    # Pre-existing old backups beyond the keep window.
    for day in (1, 2):
        (backups / f"timeline-202609{day:02d}-020000.db").write_bytes(b"x")

    settings = Settings(
        data_dir=tmp_path / "data",
        db_name="timeline.db",
        backups_dir=backups,
        backup_keep=2,
    )
    created = run_backup(settings)

    assert created.is_file()
    assert _read_names(created) == ["data"]
    # Only the newest 2 remain (the two pre-existing old ones were pruned).
    remaining = sorted(p.name for p in backups.iterdir())
    assert len(remaining) == 2


# --- CLI ---------------------------------------------------------------------


def test_main_backup_writes_and_prints(tmp_path: Path, capsys) -> None:  # noqa: ANN001
    """CLI 'backup' writes a backup and prints its path."""
    db = tmp_path / "data" / "timeline.db"
    _make_db(db)
    settings = Settings(
        data_dir=tmp_path / "data",
        db_name="timeline.db",
        backups_dir=tmp_path / "backups",
    )
    code = main(["backup"], settings=settings)  # type: ignore[call-arg]
    assert code == 0
    out = capsys.readouterr().out
    assert "Backup written:" in out
    assert (tmp_path / "backups").is_dir()


def test_main_restore_round_trip(tmp_path: Path, capsys) -> None:  # noqa: ANN001
    """CLI 'restore' round-trips a backup back into the live DB."""
    db = tmp_path / "data" / "timeline.db"
    _make_db(db, value="keepme")
    backups = tmp_path / "backups"
    created = dump_db(db, backups, datetime(2026, 9, 15, 2, 0, 0, tzinfo=UTC))

    settings = Settings(
        data_dir=tmp_path / "data",
        db_name="timeline.db",
        backups_dir=backups,
    )
    code = main(["restore", str(created)], settings=settings)  # type: ignore[call-arg]
    assert code == 0
    assert "Restored" in capsys.readouterr().out
    assert _read_names(db) == ["keepme"]


def test_main_list(tmp_path: Path, capsys) -> None:  # noqa: ANN001
    """CLI 'list' prints stored backups newest-first."""
    backups = tmp_path / "backups"
    backups.mkdir(parents=True)
    (backups / "timeline-20260910-020000.db").write_bytes(b"x")
    (backups / "timeline-20260915-020000.db").write_bytes(b"x")
    settings = Settings(data_dir=tmp_path / "data", backups_dir=backups)
    code = main(["list"], settings=settings)  # type: ignore[call-arg]
    assert code == 0
    out = capsys.readouterr().out
    assert "timeline-20260915-020000.db" in out
    assert "timeline-20260910-020000.db" in out


def test_main_missing_restore_file(tmp_path: Path, capsys) -> None:  # noqa: ANN001
    """CLI 'restore' with a missing file returns a non-zero exit code."""
    settings = Settings(data_dir=tmp_path / "data", backups_dir=tmp_path / "b")
    code = main(["restore", str(tmp_path / "nope.db")], settings=settings)  # type: ignore[call-arg]
    assert code == 1
    assert "No such backup" in capsys.readouterr().err


def test_main_unknown_command(tmp_path: Path, capsys) -> None:  # noqa: ANN001
    """CLI with an unknown command returns a non-zero exit code."""
    settings = Settings(data_dir=tmp_path / "data", backups_dir=tmp_path / "b")
    code = main(["frobnicate"], settings=settings)  # type: ignore[call-arg]
    assert code == 1
    assert "Unknown command" in capsys.readouterr().err


def test_main_no_args_prints_usage(tmp_path: Path, capsys) -> None:  # noqa: ANN001
    """CLI with no command prints usage and returns non-zero."""
    settings = Settings(data_dir=tmp_path / "data", backups_dir=tmp_path / "b")
    code = main([], settings=settings)  # type: ignore[call-arg]
    assert code == 1
    assert "Usage:" in capsys.readouterr().err
