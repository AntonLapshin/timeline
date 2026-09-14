"""Telegram outbound reminder sender with Ack / Snooze / Delete (issue #55, M4-T2).

This module turns a due reminder (produced by the scheduler in ``app.scheduler``,
issue #57 / M4-T1) into a Telegram priority card with inline action buttons:

- **Acknowledge** — marks the delivered reminder as ``acked`` in the audit trail.
- **Snooze (1 day)** — records a ``snoozed`` delivery and re-schedules the same
  reminder one day later through APScheduler.
- **Delete** — suppresses the reminder (marks the delivery ``deleted``) so it is
  not re-sent.

The pure business logic lives here and is fully unit-tested: card formatting
(``format_reminder_card``), countdown text (``countdown_text``), the priority
emoji map (``priority_emoji``), the low-priority suppression rule
(``should_push``), the single-user allowlist (``is_allowed_user``), the inline
callback-data codec (``callback_data`` / ``parse_callback_data``) and the
per-action state transitions (``ack_delivery``, ``snooze_delivery``,
``delete_delivery``). The impure Telegram wiring (``send_reminder_card`` /
``make_telegram_job_func``) is a thin adapter over python-telegram-bot v21
(polling) and is kept to a minimum.

Only the configured single Telegram user (``settings.telegram_user_id``) is
allowed to receive cards; anything else is rejected by ``is_allowed_user``. Low
priority events are never pushed (``should_push``). The bot never sends a card
when no bot token is configured.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from sqlalchemy.orm import Session, sessionmaker

from .config import Settings
from .enums import EventPriority
from .models import DeliveryLog, Event
from .scheduler import PlannedReminder, add_reminder_job, deliver_reminder

logger = logging.getLogger(__name__)

#: Separator used inside inline button callback data (never appears in the
#: occurrence id or offset, unlike ``:`` which appears in ISO timestamps).
_CB_SEP = "|"

#: How long a Snooze defers a reminder before it is re-sent.
_SNOOZE_DELTA = timedelta(days=1)

#: DeliveryLog statuses written by the action buttons.
_STATUS_ACKED = "acked"
_STATUS_SNOOZED = "snoozed"
_STATUS_DELETED = "deleted"

#: Emoji shown per event priority on the card (LOW is never pushed).
_PRIORITY_EMOJI: dict[EventPriority, str] = {
    EventPriority.CRITICAL: "🔥",
    EventPriority.MEDIUM: "⏰",
    EventPriority.LOW: "💤",
}

#: Inline action labels shown on the card buttons.
_ACTION_ACK = "ack"
_ACTION_SNOOZE = "snooze"
_ACTION_DELETE = "delete"
_ACTION_LABELS: dict[str, str] = {
    _ACTION_ACK: "✅ Ack",
    _ACTION_SNOOZE: "😴 Snooze 1d",
    _ACTION_DELETE: "🗑 Delete",
}


class _CardEvent(Protocol):
    """The subset of an event the card formatter reads (duck-typed)."""

    title: str
    description: str
    start_at: datetime
    priority: EventPriority


def priority_emoji(priority: EventPriority) -> str:
    """Return the emoji for a priority (defaults to the medium bell)."""
    return _PRIORITY_EMOJI.get(priority, _PRIORITY_EMOJI[EventPriority.MEDIUM])


def should_push(priority: EventPriority) -> bool:
    """Whether a priority warrants a proactive push (low priority is suppressed).

    Low-priority events are recorded but never proactively pushed to Telegram.
    """
    return priority != EventPriority.LOW


def is_allowed_user(user_id: str | None, allowed: str | None) -> bool:
    """Single-user allowlist: True only when the sender is the configured user.

    ``None`` for either side means the allowlist is not configured, so nothing
    is allowed (fail closed).
    """
    if user_id is None or allowed is None:
        return False
    return str(user_id) == str(allowed)


def countdown_text(target: datetime, now: datetime) -> str:
    """Human countdown from ``now`` to ``target``, e.g. ``"in 1h 30m"``.

    Returns ``"now"`` when the target is in the past or within the same minute.
    """
    remaining = target - now
    if remaining <= timedelta(0):
        return "now"
    total_minutes = int(remaining.total_seconds() // 60)
    if total_minutes < 1:
        return "now"
    hours, minutes = divmod(total_minutes, 60)
    if hours:
        return f"in {hours}h {minutes}m"
    return f"in {minutes}m"


def format_reminder_card(
    event: _CardEvent,
    occurrence_id: str,
    offset: str,
    now: datetime | None = None,
) -> str:
    """Build the Telegram priority card for a delivered reminder.

    The card shows an emoji, the event title, the occurrence date/time, a
    countdown to the occurrence, and the event notes (description). ``offset``
    is the reminder offset that fired (e.g. ``"1h"``).
    """
    now = now or datetime.now(UTC)
    start = event.start_at
    # Datetimes are stored naive (UTC) in SQLite; normalize for countdown math.
    if start.tzinfo is None:
        start = start.replace(tzinfo=UTC)
    emoji = priority_emoji(event.priority)
    lines: list[str] = [
        f"{emoji} {event.title}",
        f"🕐 {start:%a, %b %d, %Y} {start:%H:%M} ({countdown_text(start, now)})",
        f"⏳ reminder {offset} before",
    ]
    if event.description:
        lines.append(f"📝 {event.description}")
    lines.append(f"`{occurrence_id}`")
    return "\n".join(lines)


def callback_data(action: str, event_id: int, occurrence_id: str, offset: str) -> str:
    """Encode inline-button callback data for an action on a reminder.

    Format: ``{action}|{event_id}|{occurrence_id}|{offset}``. The ``|``
    separator is safe because neither the occurrence id (ISO timestamp) nor the
    offset (e.g. ``"1h"``) contains it.
    """
    return _CB_SEP.join((action, str(event_id), occurrence_id, offset))


def parse_callback_data(data: str) -> tuple[str, int, str, str] | None:
    """Inverse of :func:`callback_data`; returns None for malformed input."""
    parts = data.split(_CB_SEP)
    if len(parts) != 4:
        return None
    action, raw_event_id, occurrence_id, offset = parts
    try:
        event_id = int(raw_event_id)
    except ValueError:
        return None
    if not occurrence_id or not offset:
        return None
    return action, event_id, occurrence_id, offset


def build_reply_markup(
    event_id: int, occurrence_id: str, offset: str
) -> dict[str, Any]:
    """Return the Telegram inline-keyboard markup for the action buttons."""
    buttons = [
        [
            {
                "text": _ACTION_LABELS[_ACTION_ACK],
                "callback_data": callback_data(
                    _ACTION_ACK, event_id, occurrence_id, offset
                ),
            },
            {
                "text": _ACTION_LABELS[_ACTION_SNOOZE],
                "callback_data": callback_data(
                    _ACTION_SNOOZE, event_id, occurrence_id, offset
                ),
            },
            {
                "text": _ACTION_LABELS[_ACTION_DELETE],
                "callback_data": callback_data(
                    _ACTION_DELETE, event_id, occurrence_id, offset
                ),
            },
        ]
    ]
    return {"inline_keyboard": buttons}


# --- action state transitions (pure, DB-backed) ------------------------------


def ack_delivery(
    session: Session, event_id: int, occurrence_id: str, offset: str
) -> bool:
    """Mark the delivered reminder as acknowledged.

    Updates the ``sent`` DeliveryLog for the reminder to ``acked`` and returns
    True when a matching log was updated.
    """
    log = (
        session.query(DeliveryLog)
        .filter_by(
            event_id=event_id,
            occurrence_id=occurrence_id,
            offset=offset,
            status="sent",
        )
        .first()
    )
    if log is None:
        return False
    log.status = _STATUS_ACKED
    return True


def snooze_delivery(
    session: Session,
    event_id: int,
    occurrence_id: str,
    offset: str,
    now: datetime | None = None,
) -> PlannedReminder | None:
    """Record a snooze and return the re-scheduled reminder (one day later).

    The current delivery is marked ``snoozed`` and a new ``PlannedReminder``
    dated one day from ``now`` is returned so the caller can schedule it. The
    new reminder uses a distinct occurrence id so its dedupe key does not
    collide with the original.
    """
    now = now or datetime.now(UTC)
    log = (
        session.query(DeliveryLog)
        .filter_by(
            event_id=event_id,
            occurrence_id=occurrence_id,
            offset=offset,
            status="sent",
        )
        .first()
    )
    if log is None:
        return None
    log.status = _STATUS_SNOOZED
    snooze_occurrence = f"{occurrence_id}~snooze@{now:%Y%m%d%H%M%S}"
    return PlannedReminder(
        event_id=event_id,
        occurrence_id=snooze_occurrence,
        offset=offset,
        run_at=now + _SNOOZE_DELTA,
    )


def delete_delivery(
    session: Session, event_id: int, occurrence_id: str, offset: str
) -> bool:
    """Suppress a delivered reminder so it is not re-sent.

    Marks the matching ``sent`` DeliveryLog as ``deleted`` and returns True when
    a matching log was updated.
    """
    log = (
        session.query(DeliveryLog)
        .filter_by(
            event_id=event_id,
            occurrence_id=occurrence_id,
            offset=offset,
            status="sent",
        )
        .first()
    )
    if log is None:
        return False
    log.status = _STATUS_DELETED
    return True


def handle_callback(
    *,
    data: str,
    session: Session,
    scheduler: Any,
    job_func: Callable[..., object],
    now: datetime | None = None,
) -> str:
    """Apply an inline-button action (ack / snooze / delete) to a reminder.

    Parses the callback ``data`` and dispatches to the matching state
    transition. Snooze re-schedules the reminder one day later through the
    scheduler with the same job function. Returns a human message for the bot
    to answer the callback query with.
    """
    parsed = parse_callback_data(data)
    if parsed is None:
        return "Invalid action"
    action, event_id, occurrence_id, offset = parsed
    if action == _ACTION_ACK:
        ok = ack_delivery(session, event_id, occurrence_id, offset)
        return "Acknowledged ✓" if ok else "Nothing to acknowledge"
    if action == _ACTION_SNOOZE:
        planned = snooze_delivery(session, event_id, occurrence_id, offset, now=now)
        if planned is None:
            return "Nothing to snooze"
        add_reminder_job(scheduler, planned, job_func)
        return "Snoozed for 1 day 😴"
    if action == _ACTION_DELETE:
        ok = delete_delivery(session, event_id, occurrence_id, offset)
        return "Reminder deleted 🗑" if ok else "Nothing to delete"
    return "Unknown action"


# --- impure wiring (python-telegram-bot v21) ---------------------------------


class _Bot(Protocol):
    """The minimal python-telegram-bot surface this module uses."""

    async def send_message(
        self,
        chat_id: int,
        text: str,
        reply_markup: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any: ...


async def send_reminder_card(
    bot: _Bot,
    chat_id: int,
    text: str,
    reply_markup: dict[str, Any] | None = None,
) -> None:
    """Send a reminder card to ``chat_id`` via the bot (thin adapter)."""
    await bot.send_message(chat_id=chat_id, text=text, reply_markup=reply_markup)


def make_telegram_job_func(
    session_factory: sessionmaker[Session],
    bot: _Bot,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> Callable[[int, str, str], bool]:
    """Build the scheduler job function that sends a due reminder to Telegram.

    The returned function matches the scheduler's job signature
    ``(event_id, occurrence_id, offset)`` and reuses ``deliver_reminder`` so the
    at-least-once / audit-trail semantics from the scheduler are preserved. It
    fails closed: no bot token, no allowed user, or a low-priority event means
    nothing is sent.
    """
    allowed = settings.telegram_user_id
    chat_id = _parse_chat_id(allowed)

    def job_func(event_id: int, occurrence_id: str, offset: str) -> bool:
        def send() -> None:
            with session_factory() as session:
                event = session.get(Event, event_id)
                if event is None:
                    raise RuntimeError(f"event {event_id} not found")
                if not should_push(event.priority):
                    return None
                if not is_allowed_user(allowed, settings.telegram_user_id):
                    raise PermissionError("telegram user not allowed")
                text = format_reminder_card(
                    event, occurrence_id, offset, now=now or datetime.now(UTC)
                )
                _run_send(bot, chat_id, text, event_id, occurrence_id, offset)

        return deliver_reminder(
            session_factory,
            event_id,
            occurrence_id,
            offset,
            now=now,
            send=send,
        )

    return job_func


def _parse_chat_id(allowed: str | None) -> int | None:
    """Parse the allowlisted Telegram user id into a chat id (or None)."""
    if allowed is None:
        return None
    try:
        return int(allowed)
    except ValueError:
        return None


def _run_send(
    bot: _Bot,
    chat_id: int | None,
    text: str,
    event_id: int,
    occurrence_id: str,
    offset: str,
) -> None:
    """Synchronously dispatch the async card send (thin adapter).

    Kept separate so the bot call can be injected/faked in tests; the async
    send is awaited through the running event loop.
    """
    if chat_id is None:
        raise RuntimeError("telegram chat id not configured")
    import asyncio

    coro = send_reminder_card(
        bot, chat_id, text, build_reply_markup(event_id, occurrence_id, offset)
    )
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop (scheduler thread): drive the coroutine directly.
        asyncio.run(coro)
    else:
        # Inside a telegram handler loop: schedule on the running loop.
        loop.create_task(coro)


def build_telegram_application(settings: Settings) -> Any:
    """Build the python-telegram-bot Application with polling (thin adapter).

    Returns ``None`` when no bot token is configured so the app can start
    without Telegram. The caller is responsible for ``run_polling()``.
    """
    if not settings.telegram_bot_token:
        return None
    from telegram.ext import Application

    return Application.builder().token(settings.telegram_bot_token).build()
