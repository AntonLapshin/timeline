"""Tests for bounded/rotating log setup (issue #77, M6-T1)."""

from __future__ import annotations

import logging
from pathlib import Path

from app.config import Settings
from app.logging_setup import configure_logging, rotation_params


def test_rotation_params_use_settings(tmp_path: Path) -> None:
    """Rotation params reflect the configured max bytes and backup count."""
    settings = Settings(
        data_dir=tmp_path,
        log_max_bytes=2048,
        log_backup_count=3,
    )
    assert rotation_params(settings) == (2048, 3)


def test_rotation_params_clamp_minimums(tmp_path: Path) -> None:
    """Zero/negative rotation values are clamped so rotation cannot be disabled."""
    settings = Settings(
        data_dir=tmp_path,
        log_max_bytes=0,
        log_backup_count=0,
    )
    assert rotation_params(settings) == (1024, 1)


def test_rotation_params_defaults(tmp_path: Path) -> None:
    """Defaults are 5 MB max and 5 backups."""
    settings = Settings(data_dir=tmp_path)
    assert rotation_params(settings) == (5 * 1024 * 1024, 5)


def test_configure_logging_attaches_rotating_handler(tmp_path: Path) -> None:
    """With a log_file set, a rotating file handler is attached to root."""
    log_file = tmp_path / "logs" / "timeline.log"
    settings = Settings(data_dir=tmp_path, log_file=str(log_file))
    configure_logging(settings)
    root = logging.getLogger()
    try:
        handlers = [
            h
            for h in root.handlers
            if getattr(h, "baseFilename", None) == str(log_file)
        ]
        assert len(handlers) == 1
        handler = handlers[0]
        assert handler.maxBytes == 5 * 1024 * 1024
        assert handler.backupCount == 5
        # The file is actually created on first write.
        handler.emit(logging.LogRecord("x", logging.INFO, "", 0, "hello", (), None))
        assert log_file.exists()
    finally:
        root.handlers = [
            h
            for h in root.handlers
            if getattr(h, "baseFilename", None) != str(log_file)
        ]


def test_configure_logging_noop_without_log_file(tmp_path: Path) -> None:
    """Without a log_file, no file handler is added (logging stays on stderr)."""
    settings = Settings(data_dir=tmp_path, log_file=None)
    before = list(logging.getLogger().handlers)
    configure_logging(settings)
    assert list(logging.getLogger().handlers) == before


def test_configure_logging_creates_parent_dir(tmp_path: Path) -> None:
    """The log file parent directory is created if missing."""
    log_file = tmp_path / "nested" / "deep" / "timeline.log"
    settings = Settings(data_dir=tmp_path, log_file=str(log_file))
    configure_logging(settings)
    root = logging.getLogger()
    try:
        handler = next(
            h
            for h in root.handlers
            if getattr(h, "baseFilename", None) == str(log_file)
        )
        handler.emit(logging.LogRecord("x", logging.INFO, "", 0, "hello", (), None))
        assert log_file.exists()
    finally:
        root.handlers = [
            h
            for h in root.handlers
            if getattr(h, "baseFilename", None) != str(log_file)
        ]
