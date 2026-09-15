"""Nightly SQLite backup + rotation + one-command restore (issue #85, M6-T2).

Provides a pure, unit-testable backup module: it dumps the SQLite database
(using SQLite's online backup API, which is safe with WAL mode) into
``./backups/`` under a timestamped name, prunes old backups keeping the newest
``keep`` (default 30), and restores a backup into the live database. A CLI
(``python -m app.backup``) gives one-command backup / list / restore:

    python -m app.backup backup                       # dump + prune now
    python -m app.backup list                         # show stored backups
    python -m app.backup restore backups/timeline-20260915-020000.db

Nightly runs are driven by a systemd timer
(``systemd/timeline-backup.timer``) that calls ``python -m app.backup backup``
each night; see the README runbook.

The pure helpers (``backup_filename``, ``parse_backup_timestamp``,
``prune_names``) carry no I/O and are fully unit-testable; the impure I/O
(``dump_db``, ``restore_db``, ``prune``, ``list_backups``, ``run_backup``) and
the CLI live at the bottom. Backups are local-only and ``./backups/`` is
gitignored.
"""

from __future__ import annotations

import re
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

from .config import Settings, get_settings

#: Regex matching a backup filename: ``timeline-YYYYMMDD-HHMMSS.db``.
_BACKUP_RE = re.compile(r"^timeline-(\d{8})-(\d{6})\.db$")

#: Default number of recent backups to keep when pruning (issue #85, ~30 days).
DEFAULT_KEEP = 30


def backup_filename(now: datetime) -> str:
    """Return a timestamped backup filename for *now*.

    Example: ``timeline-20260915-020000.db``. The timestamp is embedded in the
    name (UTC) so backups sort deterministically and can be pruned by name
    without relying on filesystem mtimes.
    """
    ts = now.astimezone(UTC).strftime("%Y%m%d-%H%M%S")
    return f"timeline-{ts}.db"


def parse_backup_timestamp(name: str) -> datetime | None:
    """Parse the UTC timestamp from a backup filename.

    Returns ``None`` when *name* does not match the expected
    ``timeline-YYYYMMDD-HHMMSS.db`` pattern.
    """
    match = _BACKUP_RE.fullmatch(name)
    if match is None:
        return None
    return datetime.strptime(
        f"{match.group(1)}{match.group(2)}", "%Y%m%d%H%M%S"
    ).replace(tzinfo=UTC)


def prune_names(names: list[str], keep: int) -> list[str]:
    """Pure: return the backup filenames to delete so only the newest *keep* remain.

    Names are ordered by their embedded timestamp (newest first); names that do
    not parse as backups are treated as the oldest and removed first. When
    *keep* is non-positive every name is removed.
    """
    if keep <= 0:
        return sorted(names)
    ordered = sorted(
        names,
        key=lambda n: (
            parse_backup_timestamp(n) or datetime.min.replace(tzinfo=UTC),
            n,
        ),
        reverse=True,
    )
    return ordered[keep:]


def _sqlite_backup(src_path: Path, dst_path: Path) -> None:
    """Copy *src_path* (a SQLite DB) into *dst_path* via SQLite's online backup.

    Safe for WAL-mode databases: it reads a consistent snapshot and produces a
    plain single-file backup that restores cleanly.
    """
    src = sqlite3.connect(str(src_path))
    try:
        dst = sqlite3.connect(str(dst_path))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def dump_db(db_path: Path, backups_dir: Path, now: datetime) -> Path:
    """Dump *db_path* into *backups_dir* under a timestamped name.

    Creates *backups_dir* if missing and returns the path written. The dump is
    a consistent online backup (safe with WAL).
    """
    backups_dir.mkdir(parents=True, exist_ok=True)
    dest = backups_dir / backup_filename(now)
    _sqlite_backup(db_path, dest)
    return dest


def restore_db(backup_path: Path, db_path: Path) -> None:
    """Restore *backup_path* into *db_path*, overwriting the live database.

    The live DB file is replaced by a copy of the backup. The parent directory
    of *db_path* is created if missing. Stop the app before restoring so the
    live DB is not being written by a running process.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    _sqlite_backup(backup_path, db_path)


def prune(backups_dir: Path, keep: int) -> list[Path]:
    """Delete the oldest backups in *backups_dir*, keeping the newest *keep*.

    Returns the paths that were removed. Backups that do not parse as
    ``timeline-*.db`` are treated as oldest and removed first.
    """
    if not backups_dir.is_dir():
        return []
    names = [p.name for p in backups_dir.iterdir() if p.is_file()]
    to_remove = set(prune_names(names, keep))
    removed: list[Path] = []
    for path in backups_dir.iterdir():
        if path.is_file() and path.name in to_remove:
            path.unlink()
            removed.append(path)
    return removed


def list_backups(backups_dir: Path) -> list[Path]:
    """Return the backup files in *backups_dir* sorted newest-first."""
    if not backups_dir.is_dir():
        return []
    paths = [p for p in backups_dir.iterdir() if p.is_file()]
    paths.sort(
        key=lambda p: (
            parse_backup_timestamp(p.name) or datetime.min.replace(tzinfo=UTC),
            p.name,
        ),
        reverse=True,
    )
    return paths


def run_backup(settings: Settings) -> Path:
    """Perform a nightly backup: dump the DB then prune old backups.

    Returns the path of the backup just written. Uses the configured
    ``backups_dir`` and ``backup_keep``.
    """
    db_path = settings.data_dir / settings.db_name
    created = dump_db(db_path, settings.backups_dir, datetime.now(UTC))
    prune(settings.backups_dir, settings.backup_keep)
    return created


def main(argv: list[str] | None = None, settings: Settings | None = None) -> int:
    """CLI entrypoint: ``python -m app.backup backup|list|restore <file>``.

    Returns a process exit code (0 success, 1 error). ``settings`` may be
    injected for tests; it defaults to the environment-derived settings.
    """
    args = list(sys.argv[1:] if argv is None else argv)
    settings = settings or get_settings()
    if not args:
        print(
            "Usage: python -m app.backup {backup|list|restore <backup-file>}",
            file=sys.stderr,
        )
        return 1
    command = args[0]
    if command == "backup":
        created = run_backup(settings)
        print(f"Backup written: {created}")
        return 0
    if command == "list":
        for path in list_backups(settings.backups_dir):
            print(path)
        return 0
    if command == "restore":
        if len(args) != 2:
            print(
                "Usage: python -m app.backup restore <backup-file>",
                file=sys.stderr,
            )
            return 1
        backup_path = Path(args[1])
        if not backup_path.is_file():
            print(f"No such backup: {backup_path}", file=sys.stderr)
            return 1
        db_path = settings.data_dir / settings.db_name
        restore_db(backup_path, db_path)
        print(f"Restored {backup_path} -> {db_path}")
        return 0
    print(f"Unknown command: {command!r}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
