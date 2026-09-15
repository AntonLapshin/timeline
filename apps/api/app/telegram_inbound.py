"""Telegram inbound DM command bot (issue #69, M5-T1).

A python-telegram-bot v21 polling updater (consistent with
``telegram_outbound.py``) that answers the owner's private-chat commands:

- ``/today`` — list today's events.
- ``/upcoming [7d|30d]`` — list upcoming events (default 7 days).
- ``/low`` — list low-priority events on demand.
- ``/add <text>`` — route to the AI parse → draft flow. The parse endpoint
  (issue #70, M5-T3) is not merged yet, so this is a **stub** that records the
  inbound message and explains parsing will be wired when available.
- ``/ask <question>`` — LLM query over history. The query endpoint is not
  merged yet, so this is a **stub**, wired when available.

Only private chats from the single allowlisted user (``TELEGRAM_USER_ID``) are
answered; messages from groups/channels/other users are ignored. No bot token
configured ⇒ the inbound updater is a no-op (never polls), same guard style as
the outbound sender.

The pure business logic lives here and is fully unit-tested: the DM-only gate
(``is_private_chat``), command parsing (``parse_command``), the upcoming-days
parser (``parse_upcoming_days``), the event-listing helpers
(``events_today`` / ``events_upcoming`` / ``events_low``), the line formatter
(``format_event_line``), the command dispatcher (``handle_command``) and the
inbound-record builder (``build_inbound_record``). The impure Telegram wiring
(``_handle_update`` / ``build_telegram_inbound_application`` /
``record_inbound``) is a thin adapter over python-telegram-bot v21 (polling)
and is kept to a minimum.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, sessionmaker

from .config import Settings
from .enums import EventStatus
from .models import Event, TelegramInbound
from .recurrence import Occurrence, next_occurrences
from .telegram_outbound import is_allowed_user, priority_emoji

logger = logging.getLogger(__name__)

#: How many occurrences to expand per event when scanning for today/upcoming.
#: A 30-day horizon holds at most 30 daily occurrences, so this comfortably
#: covers it while staying well under the recurrence module's safety bound.
_MAX_OCCURRENCES = 64

#: Accepted /upcoming day arguments (per the issue: 7d or 30d).
_UPCOMING_DAYS = (7, 30)

#: Default /upcoming horizon when no argument is given.
_DEFAULT_UPCOMING_DAYS = 7


class _InboundEvent(Protocol):
    """The subset of an event the inbound logic reads (duck-typed)."""

    id: int
    title: str
    priority: Any
    tz: str
    rrule: str | None
    start_at: datetime
    end_at: datetime | None
    all_day: bool


@dataclass(frozen=True)
class Command:
    """A parsed ``/command`` and its trailing argument text."""

    name: str
    args: str


@dataclass(frozen=True)
class CommandResult:
    """The outcome of dispatching a command: the reply and its message type."""

    reply: str
    message_type: str | None = None


def is_private_chat(chat_type: str | None) -> bool:
    """DM-only gate: True only for a private chat.

    Groups, supergroups and channels are ignored so the bot never reacts to
    group/channel noise.
    """
    return chat_type == "private"


def parse_command(text: str) -> Command | None:
    """Parse a ``/command`` from message text.

    Returns a :class:`Command` when the text starts with ``/`` (e.g.
    ``"/upcoming 30d"`` → ``Command("upcoming", "30d")``), else ``None`` for
    non-command text. The command name is lower-cased so ``/Today`` works.
    """
    if not text or not text.startswith("/"):
        return None
    parts = text.split(maxsplit=1)
    name = parts[0][1:].lower()
    args = parts[1] if len(parts) > 1 else ""
    return Command(name=name, args=args)


def parse_upcoming_days(args: str) -> int | None:
    """Parse the ``/upcoming`` day argument (``7d``/``30d``/``7``/``30``).

    Returns ``None`` for an empty-or-invalid argument so the caller can fall
    back to a usage hint. An empty argument means the default (7 days).
    """
    raw = args.strip().lower()
    if not raw:
        return _DEFAULT_UPCOMING_DAYS
    if raw.endswith("d"):
        raw = raw[:-1]
    try:
        days = int(raw)
    except ValueError:
        return None
    if days in _UPCOMING_DAYS:
        return days
    return None


def _zone(event: _InboundEvent) -> ZoneInfo:
    """The event's IANA timezone (for local date interpretation)."""
    return ZoneInfo(event.tz)


def _as_utc(dt: datetime) -> datetime:
    """Normalize a (possibly naive) datetime to an aware UTC datetime."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def events_today(
    events: Sequence[_InboundEvent], now: datetime
) -> list[tuple[_InboundEvent, Occurrence]]:
    """Events with an occurrence on today's local date (each in its own tz).

    Occurrences are expanded forward from the start of today (in each event's
    local timezone) and filtered to those whose start falls on the event's
    local calendar date of ``now``. Using the start of today as the lower
    bound includes all-day events (anchored at local midnight) that fall today.
    Returned in ascending occurrence order.
    """
    now = _as_utc(now)
    result: list[tuple[_InboundEvent, Occurrence]] = []
    for event in events:
        zone = _zone(event)
        today = now.astimezone(zone).date()
        start_of_today = datetime(
            today.year, today.month, today.day, tzinfo=zone
        ).astimezone(UTC)
        for occ in next_occurrences(event, _MAX_OCCURRENCES, after=start_of_today):
            local_date = occ.start.astimezone(zone).date()
            if local_date == today:
                result.append((event, occ))
            elif local_date > today:
                break
    result.sort(key=lambda eo: eo[1].start)
    return result


def events_upcoming(
    events: Sequence[_InboundEvent], now: datetime, days: int
) -> list[tuple[_InboundEvent, Occurrence]]:
    """Events with an occurrence within the next ``days`` days (each in its own tz).

    The horizon is interpreted in each event's local timezone. Occurrences are
    expanded forward from the start of today (so today's all-day events are
    included) and filtered to those starting before the horizon. Returned in
    ascending occurrence order.
    """
    now = _as_utc(now)
    result: list[tuple[_InboundEvent, Occurrence]] = []
    for event in events:
        zone = _zone(event)
        today = now.astimezone(zone).date()
        start_of_today = datetime(
            today.year, today.month, today.day, tzinfo=zone
        ).astimezone(UTC)
        horizon = (now + timedelta(days=days)).astimezone(zone)
        for occ in next_occurrences(event, _MAX_OCCURRENCES, after=start_of_today):
            if occ.start.astimezone(zone) < horizon:
                result.append((event, occ))
            else:
                break
    result.sort(key=lambda eo: eo[1].start)
    return result


def events_low(
    events: Sequence[_InboundEvent], now: datetime
) -> list[tuple[_InboundEvent, Occurrence]]:
    """Low-priority events with their next occurrence at/after ``now``.

    Returned in ascending next-occurrence order.
    """
    now = _as_utc(now)
    result: list[tuple[_InboundEvent, Occurrence]] = []
    for event in events:
        if str(event.priority) != "low":
            continue
        occs = next_occurrences(event, 1, after=now)
        if occs:
            result.append((event, occs[0]))
    result.sort(key=lambda eo: eo[1].start)
    return result


def format_event_line(
    event: _InboundEvent, occurrence: Occurrence, *, include_date: bool = True
) -> str:
    """Format one event occurrence as a Telegram reply line.

    e.g. ``"⏰ Team standup — Mon, Sep 15 10:00"`` (with date) or
    ``"⏰ Team standup — 10:00"`` (without date, for today's list). All-day
    events show ``"All day"`` instead of a time.
    """
    zone = _zone(event)
    local = occurrence.start.astimezone(zone)
    emoji = priority_emoji(event.priority)
    when = "All day" if event.all_day else f"{local:%H:%M}"
    if include_date:
        return f"{emoji} {event.title} — {local:%a, %b %d} {when}"
    return f"{emoji} {event.title} — {when}"


def handle_command(
    command: Command,
    events: Sequence[_InboundEvent],
    now: datetime | None = None,
) -> CommandResult:
    """Dispatch a parsed command to its handler and return the reply.

    ``/today``, ``/upcoming`` and ``/low`` list events from the provided
    (active) ``events``; ``/add`` and ``/ask`` are stubs until the parse/query
    endpoint (issue #70) is merged. Unknown commands get a usage hint.
    """
    now = _as_utc(now or datetime.now(UTC))
    if command.name == "today":
        return _reply_today(events, now)
    if command.name == "upcoming":
        return _reply_upcoming(events, command.args, now)
    if command.name == "low":
        return _reply_low(events, now)
    if command.name == "add":
        return _reply_add(command.args)
    if command.name == "ask":
        return _reply_ask(command.args)
    return CommandResult(
        reply=(
            "Unknown command. Try /today, /upcoming [7d|30d], /low, "
            "/add <text> or /ask <question>."
        )
    )


def _reply_today(events: Sequence[_InboundEvent], now: datetime) -> CommandResult:
    """Build the /today reply listing today's events."""
    items = events_today(events, now)
    if not items:
        return CommandResult(reply="No events today.", message_type="text")
    lines = ["📅 Today"]
    lines.extend(format_event_line(e, o, include_date=False) for e, o in items)
    return CommandResult(reply="\n".join(lines), message_type="text")


def _reply_upcoming(
    events: Sequence[_InboundEvent], args: str, now: datetime
) -> CommandResult:
    """Build the /upcoming reply (default 7d, or 30d when requested)."""
    days = parse_upcoming_days(args)
    if days is None:
        return CommandResult(
            reply="Usage: /upcoming [7d|30d] (default 7 days).",
            message_type="text",
        )
    items = events_upcoming(events, now, days)
    if not items:
        return CommandResult(
            reply=f"No upcoming events in the next {days} days.",
            message_type="text",
        )
    lines = [f"📆 Upcoming {days} days"]
    lines.extend(format_event_line(e, o) for e, o in items)
    return CommandResult(reply="\n".join(lines), message_type="text")


def _reply_low(events: Sequence[_InboundEvent], now: datetime) -> CommandResult:
    """Build the /low reply listing low-priority events."""
    items = events_low(events, now)
    if not items:
        return CommandResult(reply="No low-priority events.", message_type="text")
    lines = ["💤 Low priority"]
    lines.extend(format_event_line(e, o) for e, o in items)
    return CommandResult(reply="\n".join(lines), message_type="text")


def _reply_add(args: str) -> CommandResult:
    """Stub for /add: record the text; AI parsing wires in when merged (#70)."""
    text = args.strip()
    if not text:
        return CommandResult(
            reply="Usage: /add <event text>, e.g. /add dentist tomorrow 9am.",
            message_type="text",
        )
    return CommandResult(
        reply=(
            f'📝 Got it: "{text}". AI parsing isn\'t wired up yet — add it '
            "manually in the web app for now."
        ),
        message_type="text",
    )


def _reply_ask(args: str) -> CommandResult:
    """Stub for /ask: LLM query over history wires in when merged (#70)."""
    text = args.strip()
    if not text:
        return CommandResult(
            reply="Usage: /ask <question>, e.g. /ask when is my next dentist.",
            message_type="text",
        )
    return CommandResult(
        reply=(
            f'🤖 Ask: "{text}". The LLM query over history isn\'t available '
            "yet — it will be wired when the query endpoint lands."
        ),
        message_type="text",
    )


def build_inbound_record(message: Any, message_type: str | None) -> TelegramInbound:
    """Build a ``TelegramInbound`` row from a telegram message-like object.

    Pure data mapping (no persistence); the caller persists the row. Reads the
    message id, chat id, from-user id and text via duck-typed attributes.
    """
    chat = getattr(message, "chat", None)
    return TelegramInbound(
        telegram_message_id=str(getattr(message, "message_id", None)),
        chat_id=str(getattr(chat, "id", None)) if chat is not None else None,
        message_type=message_type,
        text=getattr(message, "text", None),
    )


def record_inbound(
    session: Session, message: Any, message_type: str | None
) -> TelegramInbound:
    """Persist an inbound DM message as a ``TelegramInbound`` row (thin adapter)."""
    record = build_inbound_record(message, message_type)
    session.add(record)
    session.commit()
    return record


def _active_events(session: Session) -> list[Event]:
    """All active events ordered by id (thin DB adapter)."""
    return (
        session.query(Event)
        .filter(Event.status == EventStatus.ACTIVE)
        .order_by(Event.id)
        .all()
    )


def _handle_update(
    update: Any,
    settings: Settings,
    session_factory: sessionmaker[Session] | None = None,
    *,
    now: datetime | None = None,
) -> str | None:
    """Process one inbound update and return the reply to send (or None).

    Thin adapter that applies the DM-only gate and the single-user allowlist
    (ignoring group/channel/other-user noise), parses the command, dispatches
    to the pure handler and persists the inbound message. Returns ``None`` when
    the update is ignored (no message, not a private chat, not the allowed
    user, or non-command text).
    """
    message = getattr(update, "effective_message", None) or getattr(
        update, "message", None
    )
    if message is None:
        return None
    if not is_private_chat(getattr(getattr(message, "chat", None), "type", None)):
        return None
    user = getattr(message, "from_user", None)
    user_id = getattr(user, "id", None) if user is not None else None
    if not is_allowed_user(user_id, settings.telegram_user_id):
        return None

    text = getattr(message, "text", None) or ""
    command = parse_command(text)
    if command is None:
        return None

    events: list[Event] = []
    if session_factory is not None:
        with session_factory() as session:
            events = _active_events(session)

    result = handle_command(command, events, now=now)

    if session_factory is not None:
        with session_factory() as session:
            record_inbound(session, message, result.message_type)
    return result.reply


def build_telegram_inbound_application(
    settings: Settings,
    session_factory: sessionmaker[Session] | None = None,
    *,
    now: datetime | None = None,
) -> Any:
    """Build the python-telegram-bot Application with an inbound DM handler.

    Returns ``None`` when no bot token is configured so the app can start
    without Telegram (same guard as the outbound sender). The caller is
    responsible for ``run_polling()``.
    """
    if not settings.telegram_bot_token:
        return None
    from telegram.ext import Application, MessageHandler, filters

    app = Application.builder().token(settings.telegram_bot_token).build()

    async def handler(update: Any, _context: Any) -> None:
        reply = _handle_update(update, settings, session_factory, now=now)
        if reply is None:
            return
        message = getattr(update, "effective_message", None) or getattr(
            update, "message", None
        )
        if message is not None:
            await message.reply_text(reply)

    app.add_handler(MessageHandler(filters.TEXT, handler))
    return app
