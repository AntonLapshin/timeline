"""Tests for the email reminder sender behind a feature flag (issue #61, M4-T3B).

Covers the acceptance criteria:

- **Feature flag off by default**: while ``EMAIL_ENABLED`` is off, no email is
  sent regardless of event channels.
- **Channel gating**: email is delivered only for events whose ``channels``
  include ``email``, and only when the flag is enabled.
- **Pure helpers**: ``should_send_email``, ``build_email_message``,
  ``build_smtp_config``, ``redact_credentials`` are unit-tested in isolation.
- **Mocked SMTP**: ``send_email`` / ``make_email_job_func`` use a fake SMTP
  client (no real network).
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.email_outbound import (
    SmtpConfig,
    _dispatch_send,
    build_email_message,
    build_smtp_config,
    make_email_job_func,
    redact_credentials,
    send_email,
    should_send_email,
)
from app.enums import EventChannel, EventPriority, EventSource, EventStatus, EventType
from app.models import DeliveryLog, Event


@pytest.fixture()
def session_factory(tmp_path: Path) -> sessionmaker[Session]:
    """A session factory over an isolated temp DB."""
    settings = Settings(data_dir=tmp_path, db_name="email.db")
    engine = create_engine_from_settings(settings)
    models.Base.metadata.create_all(engine)
    return make_session_factory(engine)


def _event(**overrides: object) -> Event:
    """Build a minimal valid Event with an email channel."""
    values: dict[str, object] = {
        "title": "Dentist",
        "description": "Root canal",
        "type": EventType.ONE_TIME,
        "start_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        "tz": "UTC",
        "priority": EventPriority.MEDIUM,
        "source": EventSource.WEB,
        "status": EventStatus.ACTIVE,
        "reminder_offsets": ["1h"],
        "channels": [EventChannel.EMAIL],
    }
    values.update(overrides)
    return Event(**values)


def _now() -> datetime:
    return datetime(2026, 1, 1, 8, 30, tzinfo=UTC)


def _email_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "email_enabled": True,
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_user": "user",
        "smtp_pass": "secret",
        "smtp_from": "from@example.com",
        "smtp_to": "to@example.com",
    }
    values.update(overrides)
    return Settings(**values)


# --- pure helpers ------------------------------------------------------------


def test_should_send_email_flag_off_default() -> None:
    """With the feature flag off, no email is sent even for an email channel."""
    assert should_send_email(False, [EventChannel.EMAIL]) is False
    assert (
        should_send_email(False, [EventChannel.TELEGRAM, EventChannel.EMAIL]) is False
    )


def test_should_send_email_requires_email_channel() -> None:
    """Email is sent only when the flag is on and email is a configured channel."""
    assert should_send_email(True, [EventChannel.EMAIL]) is True
    assert should_send_email(True, [EventChannel.TELEGRAM]) is False
    assert should_send_email(True, []) is False


def test_redact_credentials() -> None:
    """A present password redacts to ***; None stays None."""
    assert redact_credentials("secret") == "***"
    assert redact_credentials(None) is None
    assert redact_credentials("") is None


def test_build_smtp_config() -> None:
    """SMTP config is assembled from settings."""
    config = build_smtp_config(_email_settings())
    assert config.host == "smtp.example.com"
    assert config.port == 587
    assert config.user == "user"
    assert config.password == "secret"
    assert config.from_addr == "from@example.com"
    assert config.to_addr == "to@example.com"


def test_build_smtp_config_missing_required() -> None:
    """Missing host/from/to raises ValueError (never silently drop)."""
    with pytest.raises(ValueError):
        build_smtp_config(_email_settings(smtp_host=None))
    with pytest.raises(ValueError):
        build_smtp_config(_email_settings(smtp_from=None))
    with pytest.raises(ValueError):
        build_smtp_config(_email_settings(smtp_to=None))


def test_build_email_message_contents() -> None:
    """The message carries subject, body, from/to and occurrence details."""
    event = _event()
    msg = build_email_message(event, "occ-1", "1h", "to@example.com")
    assert msg["Subject"] == "⏰ Reminder: Dentist"
    assert msg["To"] == "to@example.com"
    assert msg["From"] == "to@example.com"
    body = msg.get_content()
    assert "Dentist" in body
    assert "Root canal" in body
    assert "occ-1" in body
    assert "1h" in body


def test_build_email_message_omits_notes_when_empty() -> None:
    """An event with no description renders no notes line."""
    event = _event(description="")
    msg = build_email_message(event, "occ-1", "1h", "to@example.com")
    assert "Notes:" not in msg.get_content()


# --- impure wiring (mocked SMTP) ---------------------------------------------


def test_send_email_calls_smtp_client() -> None:
    """send_email delegates to the injected SMTP client (no real network)."""
    sent: list[object] = []

    class FakeSmtp:
        def send_message(self, message: object) -> None:
            sent.append(message)

    event = _event()
    msg = build_email_message(event, "occ-1", "1h", "to@example.com")
    config = SmtpConfig(
        host="smtp.example.com",
        port=587,
        user="user",
        password="secret",
        from_addr="from@example.com",
        to_addr="to@example.com",
    )
    send_email(FakeSmtp(), config, msg)
    assert len(sent) == 1
    assert sent[0] is msg


def test_dispatch_send_opens_real_smtp_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """_dispatch_send opens a real smtplib.SMTP when none is injected.

    Monkeypatches smtplib.SMTP so the network branch (connect/STARTTLS/login/
    quit) is exercised without any real I/O.
    """
    calls: list[str] = []
    sent: list[object] = []

    class FakeRealSmtp:
        def __init__(self, host: str, port: int, timeout: int = 30) -> None:
            calls.append(f"connect:{host}:{port}:{timeout}")

        def starttls(self) -> None:
            calls.append("starttls")

        def login(self, user: str, password: str) -> None:
            calls.append(f"login:{user}:{password}")

        def send_message(self, message: object) -> None:
            sent.append(message)

        def quit(self) -> None:
            calls.append("quit")

    monkeypatch.setattr("app.email_outbound.smtplib.SMTP", FakeRealSmtp)

    event = _event()
    msg = build_email_message(event, "occ-1", "1h", "to@example.com")
    config = SmtpConfig(
        host="smtp.example.com",
        port=587,
        user="user",
        password="secret",
        from_addr="from@example.com",
        to_addr="to@example.com",
    )
    _dispatch_send(None, config, msg)
    assert len(sent) == 1
    assert sent[0] is msg
    assert calls == [
        "connect:smtp.example.com:587:30",
        "starttls",
        "login:user:secret",
        "quit",
    ]


def test_dispatch_send_no_credentials_skips_login(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Without credentials the real SMTP branch skips login."""
    calls: list[str] = []

    class FakeRealSmtp:
        def __init__(self, host: str, port: int, timeout: int = 30) -> None:
            calls.append(f"connect:{host}:{port}")

        def starttls(self) -> None:
            calls.append("starttls")

        def login(self, user: str, password: str) -> None:
            calls.append("login")

        def send_message(self, message: object) -> None:
            pass

        def quit(self) -> None:
            calls.append("quit")

    monkeypatch.setattr("app.email_outbound.smtplib.SMTP", FakeRealSmtp)

    event = _event()
    msg = build_email_message(event, "occ-1", "1h", "to@example.com")
    config = SmtpConfig(
        host="smtp.example.com",
        port=587,
        user=None,
        password=None,
        from_addr="from@example.com",
        to_addr="to@example.com",
    )
    _dispatch_send(None, config, msg)
    assert calls == ["connect:smtp.example.com:587", "starttls", "quit"]
    assert "login" not in calls


def test_make_email_job_func_sends_and_records(
    session_factory: sessionmaker[Session],
) -> None:
    """The job func sends an email and records a sent DeliveryLog."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeSmtp:
        def send_message(self, message: object) -> None:
            sent.append(message)

    settings = _email_settings()
    job_func = make_email_job_func(
        session_factory, settings, smtp=FakeSmtp(), now=_now()
    )
    assert job_func(event_id, "occ", "1h") is True
    assert len(sent) == 1
    with session_factory() as session:
        assert session.query(DeliveryLog).one().status == "sent"


def test_make_email_job_func_idempotent(
    session_factory: sessionmaker[Session],
) -> None:
    """Sending the same reminder twice only sends once (dedupe)."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeSmtp:
        def send_message(self, message: object) -> None:
            sent.append(message)

    settings = _email_settings()
    job_func = make_email_job_func(
        session_factory, settings, smtp=FakeSmtp(), now=_now()
    )
    assert job_func(event_id, "occ", "1h") is True
    assert job_func(event_id, "occ", "1h") is False
    assert len(sent) == 1


def test_make_email_job_func_flag_off_sends_nothing(
    session_factory: sessionmaker[Session],
) -> None:
    """With the feature flag off nothing is sent even for an email channel."""
    with session_factory() as session:
        event = _event()
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeSmtp:
        def send_message(self, message: object) -> None:
            sent.append(message)

    settings = _email_settings(email_enabled=False)
    job_func = make_email_job_func(
        session_factory, settings, smtp=FakeSmtp(), now=_now()
    )
    # Recorded (audit trail) but not pushed.
    assert job_func(event_id, "occ", "1h") is True
    assert sent == []


def test_make_email_job_func_skips_non_email_channel(
    session_factory: sessionmaker[Session],
) -> None:
    """An event not configured for email is not emailed."""
    with session_factory() as session:
        event = _event(channels=[EventChannel.TELEGRAM])
        session.add(event)
        session.commit()
        event_id = event.id

    sent: list[object] = []

    class FakeSmtp:
        def send_message(self, message: object) -> None:
            sent.append(message)

    settings = _email_settings()
    job_func = make_email_job_func(
        session_factory, settings, smtp=FakeSmtp(), now=_now()
    )
    assert job_func(event_id, "occ", "1h") is True
    assert sent == []


def test_make_email_job_func_missing_event(
    session_factory: sessionmaker[Session],
) -> None:
    """A job for a deleted event never sends (no silent drop)."""
    from sqlalchemy.exc import IntegrityError

    settings = _email_settings()
    sent: list[object] = []

    class FakeSmtp:
        def send_message(self, message: object) -> None:
            sent.append(message)

    job_func = make_email_job_func(
        session_factory, settings, smtp=FakeSmtp(), now=_now()
    )
    with pytest.raises(IntegrityError):
        job_func(999, "occ", "1h")
    assert sent == []
