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


# --- Email outbound settings (issue #61) -------------------------------------


def test_email_flag_defaults_off() -> None:
    """The email feature flag defaults to off in v1."""
    assert Settings(email_enabled=False).email_enabled is False


def test_email_flag_falls_back_to_off_when_env_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With EMAIL_ENABLED unset the feature flag defaults to off."""
    monkeypatch.delenv("EMAIL_ENABLED", raising=False)
    settings = Settings()
    assert settings.email_enabled is False


def test_email_flag_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """EMAIL_ENABLED=1 turns the feature flag on."""
    monkeypatch.setenv("EMAIL_ENABLED", "1")
    assert Settings().email_enabled is True


def test_email_smtp_settings_default_to_none() -> None:
    """Without env vars the SMTP settings default to None (disabled)."""
    settings = Settings(
        smtp_host=None, smtp_user=None, smtp_pass=None, smtp_from=None, smtp_to=None
    )
    assert settings.smtp_host is None
    assert settings.smtp_user is None
    assert settings.smtp_pass is None
    assert settings.smtp_from is None
    assert settings.smtp_to is None
    assert settings.smtp_port == 587


def test_email_smtp_settings_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """SMTP env vars are reflected on the settings."""
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_USER", "user")
    monkeypatch.setenv("SMTP_PASS", "secret")
    monkeypatch.setenv("SMTP_FROM", "from@example.com")
    monkeypatch.setenv("SMTP_TO", "to@example.com")
    settings = Settings()
    assert settings.smtp_host == "smtp.example.com"
    assert settings.smtp_port == 465
    assert settings.smtp_user == "user"
    assert settings.smtp_pass == "secret"
    assert settings.smtp_from == "from@example.com"
    assert settings.smtp_to == "to@example.com"


# --- LLM parse settings (issue #70) -----------------------------------------


def test_llm_settings_defaults() -> None:
    """LLM settings have safe defaults; key defaults to None (unavailable)."""
    settings = Settings(
        llm_base_url="https://gate.joingonka.ai/openai/v1",
        llm_model="",
        llm_api_key=None,
    )
    assert settings.llm_base_url == "https://gate.joingonka.ai/openai/v1"
    assert settings.llm_model == ""
    assert settings.llm_api_key is None


def test_llm_settings_fall_back_when_env_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """With LLM env vars unset, safe defaults apply and key is None."""
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    settings = Settings()
    assert settings.llm_base_url == "https://gate.joingonka.ai/openai/v1"
    assert settings.llm_model == ""
    assert settings.llm_api_key is None


def test_llm_settings_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM env vars are reflected on the settings."""
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example/v1")
    monkeypatch.setenv("LLM_MODEL", "my-model")
    monkeypatch.setenv("LLM_API_KEY", "secret-key")
    settings = Settings()
    assert settings.llm_base_url == "https://llm.example/v1"
    assert settings.llm_model == "my-model"
    assert settings.llm_api_key == "secret-key"


def test_llm_settings_accept_blank_key_as_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A blank LLM_API_KEY is treated as disabled (unavailable)."""
    monkeypatch.setenv("LLM_API_KEY", "  ")
    settings = Settings()
    assert settings.llm_api_key is None
