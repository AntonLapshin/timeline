"""Email reminder sender behind a feature flag (issue #61, M4-T3B).

Email reminders are **off by default** in v1: the ``EMAIL_ENABLED`` feature flag
defaults to false, and while it is off no email is ever sent regardless of an
event's ``channels``. When the flag is on, an email is delivered only for events
whose ``channels`` include ``email``.

The pure business logic lives here and is fully unit-tested with a mocked SMTP
client (no real network): the send decision (``should_send_email``), the message
builder (``build_email_message``), the SMTP config assembly
(``build_smtp_config``) and credential redaction (``redact_credentials``). The
impure SMTP wiring (``send_email``) is a thin adapter over ``smtplib`` and is
kept to a minimum.

SMTP credentials are read from the local ``.env`` (``SMTP_HOST``/``SMTP_PORT``/
``SMTP_USER``/``SMTP_PASS``/``SMTP_FROM``/``SMTP_TO``) and never committed;
``redact_credentials`` keeps the password out of logs.
"""

from __future__ import annotations

import logging
import smtplib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from typing import Any, Protocol

from sqlalchemy.orm import Session, sessionmaker

from .config import Settings
from .enums import EventChannel
from .models import Event
from .scheduler import deliver_reminder

logger = logging.getLogger(__name__)

#: DeliveryLog status written for a delivered email.
_STATUS_SENT = "sent"


class _EmailEvent(Protocol):
    """The subset of an event the email sender reads (duck-typed)."""

    title: str
    description: str
    start_at: datetime
    channels: list[EventChannel]
    email_to: str | None


@dataclass(frozen=True)
class SmtpConfig:
    """Assembled SMTP connection settings (from local .env only)."""

    host: str
    port: int
    user: str | None
    password: str | None
    from_addr: str
    to_addr: str


def should_send_email(
    email_enabled: bool,
    channels: list[EventChannel],
) -> bool:
    """Whether a reminder email should be sent for an event.

    Email is delivered only when the feature flag is on **and** the event's
    ``channels`` include ``email``. When the flag is off (v1 default) no email
    is sent regardless of channels.
    """
    return email_enabled and EventChannel.EMAIL in channels


def redact_credentials(password: str | None) -> str | None:
    """Redact an SMTP password for safe logging.

    Returns ``"***"`` when a password is present, else ``None`` (nothing to
    redact). The real password is never logged.
    """
    return "***" if password else None


def build_smtp_config(settings: Settings) -> SmtpConfig:
    """Assemble the SMTP connection config from local settings.

    Raises ``ValueError`` when the required ``host``/``from``/``to`` fields are
    missing, so a misconfigured flag never silently drops an email.
    """
    host = settings.smtp_host or ""
    from_addr = settings.smtp_from or ""
    to_addr = settings.smtp_to or ""
    if not host or not from_addr or not to_addr:
        raise ValueError("SMTP_HOST, SMTP_FROM and SMTP_TO are required")
    return SmtpConfig(
        host=host,
        port=settings.smtp_port,
        user=settings.smtp_user,
        password=settings.smtp_pass,
        from_addr=from_addr,
        to_addr=to_addr,
    )


def build_email_message(
    event: _EmailEvent,
    occurrence_id: str,
    offset: str,
    to_addr: str,
) -> EmailMessage:
    """Build the reminder email (subject/body) for an event occurrence.

    The message is a plain-text reminder card: emoji-free subject, event title,
    occurrence date/time and notes, plus the occurrence id and offset for
    traceability. ``to_addr`` is the configured recipient.
    """
    start = event.start_at
    if start.tzinfo is None:
        start = start.replace(tzinfo=UTC)
    msg = EmailMessage()
    msg["Subject"] = f"⏰ Reminder: {event.title}"
    msg["From"] = to_addr
    msg["To"] = to_addr
    lines: list[str] = [
        f"Reminder: {event.title}",
        f"Occurrence: {start:%a, %b %d, %Y} {start:%H:%M}",
        f"Offset: {offset} before",
    ]
    if event.description:
        lines.append(f"Notes: {event.description}")
    lines.append(f"Occurrence id: {occurrence_id}")
    msg.set_content("\n".join(lines))
    return msg


def send_email(
    smtp: Any,
    config: SmtpConfig,
    message: EmailMessage,
) -> None:
    """Send ``message`` over the provided SMTP client (thin adapter).

    ``smtp`` is any object exposing ``send_message(message)`` (a real
    ``smtplib.SMTP`` in production, a fake in tests). Kept separate so the
    network call can be injected and unit-tested without real I/O.
    """
    smtp.send_message(message)


def make_email_job_func(
    session_factory: sessionmaker[Session],
    settings: Settings,
    *,
    smtp: Any = None,
    now: datetime | None = None,
) -> Callable[[int, str, str], bool]:
    """Build the scheduler job function that sends a due reminder by email.

    The returned function matches the scheduler's job signature
    ``(event_id, occurrence_id, offset)`` and reuses ``deliver_reminder`` so the
    at-least-once / audit-trail semantics from the scheduler are preserved. It
    fails closed: when the feature flag is off, the event isn't configured for
    email, or SMTP isn't configured, nothing is sent.
    """
    config = build_smtp_config(settings) if settings.email_enabled else None

    def job_func(event_id: int, occurrence_id: str, offset: str) -> bool:
        def send() -> None:
            if not settings.email_enabled or config is None:
                return None
            with session_factory() as session:
                event = session.get(Event, event_id)
                if event is None:
                    raise RuntimeError(f"event {event_id} not found")
                if not should_send_email(settings.email_enabled, event.channels):
                    return None
                msg = build_email_message(
                    event,
                    occurrence_id,
                    offset,
                    config.to_addr,
                )
                _dispatch_send(smtp, config, msg)

        return deliver_reminder(
            session_factory,
            event_id,
            occurrence_id,
            offset,
            now=now,
            send=send,
        )

    return job_func


def _dispatch_send(
    smtp: Any,
    config: SmtpConfig,
    message: EmailMessage,
) -> None:
    """Open an SMTP connection and send (thin adapter, real network).

    Uses ``smtplib.SMTP`` with STARTTLS and login when credentials are present.
    The connection object is passed to :func:`send_email` so tests can inject a
    fake in place of the network call.
    """
    if smtp is None:
        import smtplib as _smtplib

        smtp = _smtplib.SMTP(config.host, config.port, timeout=30)
        smtp.starttls()
        if config.user and config.password:
            smtp.login(config.user, config.password)
    send_email(smtp, config, message)
    if isinstance(smtp, smtplib.SMTP):
        smtp.quit()
