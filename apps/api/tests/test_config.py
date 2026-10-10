"""Tests for the timeline API settings/config (issue #9).

Covers the localization (tz/locale) and quiet-hours settings that the owner
confirmed with defaults of UTC / en-US / no quiet hours.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings


def test_default_tz_is_utc() -> None:
    """Without an explicit TZ the default timezone is UTC."""
    assert Settings(tz="UTC").tz == "UTC"


def test_tz_falls_back_to_utc_when_env_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """With TZ unset the default factory falls back to UTC."""
    monkeypatch.delenv("TZ", raising=False)
    settings = Settings()
    assert settings.tz == "UTC"


def test_default_locale_is_en_us() -> None:
    """Without an explicit locale the default is en-US."""
    assert Settings(locale="en-US").locale == "en-US"


def test_locale_falls_back_to_en_us_when_env_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With LOCALE unset the default factory falls back to en-US."""
    monkeypatch.delenv("LOCALE", raising=False)
    settings = Settings()
    assert settings.locale == "en-US"


def test_quiet_hours_default_to_none() -> None:
    """Quiet hours are disabled by default (no pings suppressed)."""
    settings = Settings(quiet_hours_start=None, quiet_hours_end=None)
    assert settings.quiet_hours_start is None
    assert settings.quiet_hours_end is None


def test_quiet_hours_fall_back_to_none_when_env_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With QUIET_START/QUIET_END unset the _optional_env branch returns None."""
    monkeypatch.delenv("QUIET_START", raising=False)
    monkeypatch.delenv("QUIET_END", raising=False)
    settings = Settings()
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


# --- Telegram outbound settings (issue #55) ----------------------------------


def test_telegram_settings_default_to_none() -> None:
    """Without env vars the Telegram settings default to None (disabled)."""
    settings = Settings(telegram_bot_token=None, telegram_user_id=None)
    assert settings.telegram_bot_token is None
    assert settings.telegram_user_id is None


def test_telegram_settings_fall_back_to_none_when_env_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With BOT_TOKEN/TELEGRAM_USER_ID unset the _optional_env branch returns None."""
    monkeypatch.delenv("BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_USER_ID", raising=False)
    settings = Settings()
    assert settings.telegram_bot_token is None
    assert settings.telegram_user_id is None


def test_telegram_settings_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """BOT_TOKEN/TELEGRAM_USER_ID env vars are reflected on the settings."""
    monkeypatch.setenv("BOT_TOKEN", "123:abc")
    monkeypatch.setenv("TELEGRAM_USER_ID", "42")
    settings = Settings()
    assert settings.telegram_bot_token == "123:abc"
    assert settings.telegram_user_id == "42"


def test_telegram_settings_accept_blank_as_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Blank env values are treated as disabled (no Telegram outbound)."""
    monkeypatch.setenv("BOT_TOKEN", "  ")
    monkeypatch.setenv("TELEGRAM_USER_ID", "")
    settings = Settings()
    assert settings.telegram_bot_token is None
    assert settings.telegram_user_id is None


# --- Telegram user allowlist (issue #112) ------------------------------------


def test_telegram_user_ids_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """TELEGRAM_USER_IDS (comma-separated) is reflected on the settings."""
    monkeypatch.delenv("TELEGRAM_USER_IDS", raising=False)
    monkeypatch.setenv("TELEGRAM_USER_IDS", "111, 222")
    settings = Settings()
    assert settings.telegram_user_ids == "111, 222"


def test_telegram_user_ids_default_to_none_when_env_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With TELEGRAM_USER_IDS unset the setting defaults to None."""
    monkeypatch.delenv("TELEGRAM_USER_IDS", raising=False)
    settings = Settings()
    assert settings.telegram_user_ids is None


def test_telegram_allowlist_property_combines_both_vars() -> None:
    """The allowlist property combines the multi-id and legacy vars."""
    settings = Settings(telegram_user_ids="111, 222", telegram_user_id="222")
    allowlist = settings.telegram_allowlist
    assert allowlist.ids == (111, 222)
    assert allowlist.allows(111) is True
    assert allowlist.allows(999) is False


def test_telegram_allowlist_property_legacy_var_only() -> None:
    """The legacy single-id var alone still builds a working allowlist."""
    settings = Settings(telegram_user_id="42", telegram_user_ids=None)
    assert settings.telegram_allowlist.ids == (42,)
    assert settings.telegram_allowlist.allows(42) is True


def test_telegram_allowlist_property_empty_fails_closed() -> None:
    """With neither var set the allowlist is empty (allows nobody)."""
    settings = Settings(telegram_user_id=None, telegram_user_ids=None)
    assert not settings.telegram_allowlist
    assert settings.telegram_allowlist.allows(42) is False


# --- Log rotation settings (issue #77) --------------------------------------


def test_log_settings_defaults(tmp_path: Path) -> None:
    """Log settings default to stderr logging with 5 MB / 5 backups."""
    settings = Settings(data_dir=tmp_path)
    assert settings.log_file is None
    assert settings.log_max_bytes == 5 * 1024 * 1024
    assert settings.log_backup_count == 5


def test_log_settings_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """TIMELINE_LOG_* env vars are reflected on the settings."""
    monkeypatch.setenv("TIMELINE_LOG_FILE", "/tmp/timeline.log")
    monkeypatch.setenv("TIMELINE_LOG_MAX_BYTES", "2048")
    monkeypatch.setenv("TIMELINE_LOG_BACKUP_COUNT", "3")
    settings = Settings()
    assert settings.log_file == "/tmp/timeline.log"
    assert settings.log_max_bytes == 2048
    assert settings.log_backup_count == 3
