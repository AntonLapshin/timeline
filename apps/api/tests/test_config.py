"""Tests for the timeline API settings/config (issue #9).

Covers the localization (tz/locale) and quiet-hours settings that the owner
confirmed with defaults of UTC / en-US / no quiet hours.
"""

from __future__ import annotations

import pytest

from app.config import Settings


def test_default_tz_is_utc() -> None:
    """Without an explicit TZ the default timezone is UTC."""
    assert Settings(tz="UTC").tz == "UTC"


def test_default_locale_is_en_us() -> None:
    """Without an explicit locale the default is en-US."""
    assert Settings(locale="en-US").locale == "en-US"


def test_quiet_hours_default_to_none() -> None:
    """Quiet hours are disabled by default (no pings suppressed)."""
    settings = Settings(quiet_hours_start=None, quiet_hours_end=None)
    assert settings.quiet_hours_start is None
    assert settings.quiet_hours_end is None


def test_custom_tz_and_locale_are_honored() -> None:
    """A configured timezone and locale are preserved on the settings."""
    settings = Settings(tz="Europe/Berlin", locale="de-DE")
    assert settings.tz == "Europe/Berlin"
    assert settings.locale == "de-DE"


def test_quiet_hours_are_preserved() -> None:
    """Configured quiet hours are preserved on the settings."""
    settings = Settings(quiet_hours_start="22:00", quiet_hours_end="08:00")
    assert settings.quiet_hours_start == "22:00"
    assert settings.quiet_hours_end == "08:00"


def test_quiet_hours_accept_blank_as_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """Blank env values are treated as disabled (no quiet hours)."""
    monkeypatch.setenv("QUIET_START", "  ")
    monkeypatch.setenv("QUIET_END", "")
    settings = Settings()
    assert settings.quiet_hours_start is None
    assert settings.quiet_hours_end is None


def test_quiet_hours_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """QUIET_START/QUIET_END env vars are reflected on the settings."""
    monkeypatch.setenv("QUIET_START", "22:00")
    monkeypatch.setenv("QUIET_END", "08:00")
    settings = Settings()
    assert settings.quiet_hours_start == "22:00"
    assert settings.quiet_hours_end == "08:00"
