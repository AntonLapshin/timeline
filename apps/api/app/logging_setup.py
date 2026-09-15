"""Application logging setup with bounded, rotating log files (issue #77).

Adds a ``RotatingFileHandler`` to the root logger so the timeline API log never
grows unbounded, plus a pure helper that computes the rotation parameters from
settings. The pure logic (``rotation_params``) is unit-testable without touching
the filesystem.
"""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .config import Settings

_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def rotation_params(settings: Settings) -> tuple[int, int]:
    """Return ``(max_bytes, backup_count)`` rotation params from settings.

    Both values are clamped to sensible minimums so a misconfigured env var
    (0 or negative) cannot disable rotation entirely.
    """
    max_bytes = max(settings.log_max_bytes, 1024)
    backup_count = max(settings.log_backup_count, 1)
    return max_bytes, backup_count


def configure_logging(settings: Settings) -> None:
    """Attach a rotating file handler to the root logger.

    When ``settings.log_file`` is set, logs are written to that file and
    rotated once they exceed ``log_max_bytes`` bytes (keeping
    ``log_backup_count`` rotated files). Otherwise logging is left to stderr.
    """
    if not settings.log_file:
        return
    max_bytes, backup_count = rotation_params(settings)
    path = Path(settings.log_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        path, maxBytes=max_bytes, backupCount=backup_count, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter(_FORMAT))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
