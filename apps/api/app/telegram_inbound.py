"""Telegram inbound DM command bot (issue #69, M5-T1).

A python-telegram-bot v21 polling updater (consistent with
``telegram_outbound.py``) that answers the owner's private-chat commands:

- ``/today`` — list today's events.
- ``/upcoming [7d|30d]`` — list upcoming events (default 7 days).
- ``/low`` — list low-priority events on demand.
- ``/add <text>`` — deterministic offline parse (``app.quick_parse`` —
dates, times, reminders like ``1h``, priorities, recurrence words) and
present the draft as a Telegram card with inline **Save / Edit / Discard**
buttons, persisted (via the CRUD layer) only when the owner taps **Save**.
Vague text (no explicit date/time) yields a today/all-day draft the owner
corrects on the draft card — the card was already the confirmation step.
- ``/quick <text>`` — same deterministic offline parse as ``/add``
(today is the default date) with the same Save / Edit / Discard draft
card. Never touches the network.
Plain (non-command) text is treated as an implicit ``/add`` so a natural
message is parsed instead of being silently dropped; the bot sends the
draft card and replies with a ``✅ Saved`` confirmation
(``saved_confirmation_reply``) when the draft is saved.
- **voice messages** — not supported: the sender gets a short static reply
("Voice messages aren't supported — send text or use /add") instead of
silence.

Only private chats from allowlisted users (``TELEGRAM_USER_IDS`` combined
with the legacy ``TELEGRAM_USER_ID``, issue #112) are answered; messages from
groups/channels/other users are ignored (one warning log line per occurrence,
no processing, no reply, no data leakage). No bot token configured ⇒ the
inbound updater is a no-op (never polls), same guard style as the outbound
sender.

The pure business logic lives here and is fully unit-tested: the DM-only gate
(``is_private_chat``), command parsing (``parse_command``), the upcoming-days
parser (``parse_upcoming_days``), the event-listing helpers
(``events_today`` / ``events_upcoming`` / ``events_low``), the line formatter
(``format_event_line``), the command dispatcher (``handle_command``), the
confirmation helper (``saved_confirmation_reply``), the inbound-record
builder (``build_inbound_record``) and the draft-flow helpers
(``format_draft_card`` / ``format_draft_when`` / ``build_draft_keyboard`` /
``parse_draft_callback`` / ``draft_to_event_create`` / ``DraftStore``) and
the voice reply (``voice_not_supported``). The impure Telegram
wiring (``_handle_update`` / ``_handle_callback_query`` /
``build_telegram_inbound_application`` / ``record_inbound``) is a thin
adapter over python-telegram-bot v21 (polling) and is kept to a minimum.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session, sessionmaker

from . import crud, quick_parse
from .config import Settings
from .enums import EventChannel, EventPriority, EventSource, EventStatus, EventType
from .models import Event, TelegramInbound
from .quick_parse import (
    ParsedDraft,
    extract_reminder_offsets_from_text,
    normalize_reminder_offset,
)
from .recurrence import Occurrence, next_occurrences
from .redaction import redact_text
from .schemas import EventCreate
from .telegram_outbound import priority_emoji, telegram_reminder_job

logger = logging.getLogger(__name__)


#: How many times an outbound Telegram reply is attempted before giving up.
#: The 2026-10-12 outage ("nothing happened" on /add) was a single transient
#: TLS ``ConnectError`` during ``send_message``: the update was received,
#: parsed and recorded, but the draft card never reached the owner because
#: the send had no retry and no error handler was registered.
_REPLY_MAX_ATTEMPTS = 3

#: Base delay (seconds) between reply retries; backs off linearly
#: (1s, 2s, …) so a transient blip is retried quickly without hammering.
_REPLY_RETRY_BASE_DELAY_SEC = 1.0


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


@dataclass(frozen=True)
class BotReply:
    """A reply to send: text plus an optional inline keyboard (thin adapter)."""

    text: str
    reply_markup: Any | None = None


@dataclass(frozen=True)
class DraftAction:
    """A parsed draft-button action: which action on which draft index."""

    action: str  # "save" | "edit" | "discard"
    index: int


@dataclass
class PendingDraft:
    """A chat's in-memory pending draft set plus the raw text that produced it."""

    drafts: list[ParsedDraft]
    raw_input: str


class DraftStore:
    """In-memory pending-draft state keyed by ``chat_id`` (issue #75).

    Holds the pending draft per chat so a confirmed draft can be saved later
    (across updates within a session). A new ``/add`` replaces any pending
    draft for that chat. Pure in-memory state — no I/O.
    """

    def __init__(self) -> None:
        self._pending: dict[str, PendingDraft] = {}

    def set(self, chat_id: int | str, pending: PendingDraft) -> None:
        """Store (replacing) the pending draft for ``chat_id``."""
        self._pending[str(chat_id)] = pending

    def get(self, chat_id: int | str) -> PendingDraft | None:
        """Return the pending draft for ``chat_id`` (or None)."""
        return self._pending.get(str(chat_id))

    def pop(self, chat_id: int | str) -> PendingDraft | None:
        """Remove and return the pending draft for ``chat_id`` (or None)."""
        return self._pending.pop(str(chat_id), None)


def is_private_chat(chat_type: str | None) -> bool:
    """DM-only gate: True only for a private chat.

    Groups, supergroups and channels are ignored so the bot never reacts to
    group/channel noise.
    """
    return chat_type == "private"


def _gate_user(user_id: str | int | None, settings: Settings, *, kind: str) -> bool:
    """Allowlist gate for inbound updates (issue #112): True only if allowed.

    A denied sender is ignored with exactly one warning log line per
    occurrence — the sender's id is logged for diagnostics, never the message
    content (no data leakage). An empty allowlist denies everyone (fail
    closed).
    """
    if settings.telegram_allowlist.allows(user_id):
        return True
    logger.warning("Ignoring Telegram %s from non-allowlisted user %s.", kind, user_id)
    return False


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
    (active) ``events``; ``/add`` and ``/quick`` run the deterministic
    offline parse flow (the thin adapter performs the parse and presents the
    draft card). Unknown commands get a usage hint.
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
    if command.name == "quick":
        return _reply_quick(command.args)
    return CommandResult(
        reply=(
            "Unknown command. Try /today, /upcoming [7d|30d], /low, "
            "/add <text> or /quick <text>."
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


def voice_not_supported() -> str:
    """Static reply for voice messages: voice input is not supported (pure).

    There is no transcription pipeline (deterministic-only engine); the reply
    is intentionally static so a voice message never fails silently and the
    sender knows to use text instead.
    """
    return "Voice messages aren't supported — send text or use /add"


def saved_confirmation_reply(title: str) -> str:
    """Confirmation sent when a draft is saved as an event (pure)."""
    return f"✅ Saved: {title}"


def _reply_add(args: str) -> CommandResult:
    """Handle /add: empty text gets a usage hint; otherwise mark for parsing.

    The actual parse is impure (draft-store state), so the command dispatcher
    returns the stripped text with ``message_type="add_parse"`` and the thin
    adapter (``_handle_update``) performs the deterministic offline parse and
    presents the draft card.
    """
    text = args.strip()
    if not text:
        return CommandResult(
            reply=(
                "Usage: /add <event text>, e.g. "
                "/add Pick up daughter on Friday at 18:00 1h — "
                "dates, times, reminders (15m/1h/2d), priority "
                "(low/medium/critical) and recurrence "
                "(daily/weekly/monthly/quarterly/yearly) are parsed "
                "instantly offline (today is the default date)."
            ),
            message_type="text",
        )
    return CommandResult(reply=text, message_type="add_parse")


def _reply_quick(args: str) -> CommandResult:
    """Handle /quick: empty text gets a usage hint; otherwise mark for parsing.

    Like :func:`_reply_add` (``message_type="quick_parse"``) — the adapter
    always parses deterministically offline with today as the default date.
    """
    text = args.strip()
    if not text:
        return CommandResult(
            reply=(
                "Usage: /quick <event text>, e.g. "
                "/quick dentist tomorrow at 9am 15m — parsed instantly "
                "offline (today by default, reminder 1d, medium priority)."
            ),
            message_type="text",
        )
    return CommandResult(reply=text, message_type="quick_parse")


def format_draft_when(draft: ParsedDraft) -> str | None:
    """Render a draft's start time in its own tz with an explicit zone label (pure).

    The draft card is the owner's only chance to catch a mis-parsed time before
    tapping Save: showing the raw model ISO (e.g. ``2026-09-22T19:19:43+00:00``)
    reads as local wall-clock and hides a UTC-vs-local shift (the reported
    "submitted 2:50pm, scheduled 19:19" — a correctly resolved 19:19 UTC instant
    stamped while the owner's zone is America/New_York, i.e. 15:19 local).
    Rendering the wall clock in the draft's own zone with the zone name keeps
    the instant unambiguous. A naive ``start_at`` is the wall clock in the
    draft zone; an unparseable value falls back to the raw string so the card
    never breaks.
    """
    if not draft.start_at:
        return None
    zone_label = draft.tz or "UTC"
    try:
        zone = ZoneInfo(zone_label)
    except (ValueError, ZoneInfoNotFoundError):
        return draft.start_at
    try:
        parsed = datetime.fromisoformat(draft.start_at)
    except (ValueError, TypeError):
        return draft.start_at
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=zone)
    local = parsed.astimezone(zone)
    return f"{local:%a, %b %d %H:%M} ({zone_label})"


def format_draft_card(draft: ParsedDraft) -> str:
    """Render a parsed draft as a readable Telegram draft card (pure).

    Shows the title plus any fields the parser was confident about (start time,
    all-day, recurrence, priority, channels, reminder offsets, tags). The start
    time renders via ``format_draft_when`` (wall clock in the draft's own zone
    with an explicit zone label) so a UTC-stamped draft never masquerades as
    local time.
    """
    lines = [f"📝 {draft.title}"]
    when = format_draft_when(draft)
    if when is not None:
        lines.append(f"  When: {when}")
    if draft.all_day:
        lines.append("  All day: yes")
    if draft.rrule:
        lines.append(f"  Repeats: {draft.rrule}")
    if draft.priority:
        lines.append(f"  Priority: {draft.priority}")
    if draft.channels:
        lines.append(f"  Channels: {', '.join(draft.channels)}")
    if draft.reminder_offsets:
        lines.append(f"  Reminders: {', '.join(draft.reminder_offsets)} before")
    if draft.tags:
        lines.append(f"  Tags: {', '.join(draft.tags)}")
    return "\n".join(lines)


def build_draft_keyboard(index: int) -> list[tuple[str, str]]:
    """Build the (label, callback_data) buttons for one draft (pure).

    Returns the Save / Edit / Discard row; the callback data embeds the action
    and the draft index so ``parse_draft_callback`` can route it back.
    """
    return [
        ("💾 Save", f"draft:save:{index}"),
        ("✏️ Edit", f"draft:edit:{index}"),
        ("🗑 Discard", f"draft:discard:{index}"),
    ]


def parse_draft_callback(callback_data: str | None) -> DraftAction | None:
    """Parse a draft-button callback payload into a ``DraftAction`` (pure).

    Returns ``None`` for anything that isn't a well-formed ``draft:<action>:<i>``
    payload with a known action and a valid index.
    """
    if not callback_data:
        return None
    parts = callback_data.split(":")
    if len(parts) != 3 or parts[0] != "draft":
        return None
    action = parts[1]
    if action not in ("save", "edit", "discard"):
        return None
    try:
        index = int(parts[2])
    except ValueError:
        return None
    if index < 0:
        return None
    return DraftAction(action=action, index=index)


def draft_reminder_offsets(draft: ParsedDraft, raw_input: str) -> list[str]:
    """Resolve the reminder offsets for a confirmed draft (pure).

    Prefers the draft's normalized ``reminder_offsets``; when the draft gave
    none (or only invalid ones), falls back to explicit lead-time phrases in
    the raw text (*"15 minutes in advance"* → ``["15m"]``) so an explicit
    reminder request is never silently dropped. Returns ``[]`` when neither
    source names a lead time.
    """
    usable = [
        n
        for n in (normalize_reminder_offset(o) for o in draft.reminder_offsets or [])
        if n is not None
    ]
    if usable:
        return usable
    return extract_reminder_offsets_from_text(raw_input)


def draft_to_event_create(
    draft: ParsedDraft, raw_input: str, *, default_tz: str = "UTC"
) -> EventCreate:
    """Map a confirmed draft onto an ``EventCreate`` payload (pure).

    The draft is persisted with ``source=telegram_text`` and
    ``status=active`` — tapping **Save** in Telegram is the confirmation, so
    the event immediately appears in the timeline, calendar, agenda and summary
    (like a web-saved event) and its reminder jobs are scheduled. Missing
    optional fields fall back to sensible defaults (one-time, medium priority,
    telegram channel, the caller's ``default_tz`` — normally ``settings.tz``).
    Reminder offsets come from the model when present, else from explicit
    lead-time phrases in the raw text (``draft_reminder_offsets``).
    """
    return EventCreate(
        title=draft.title,
        start_at=datetime.fromisoformat(draft.start_at)
        if draft.start_at
        else datetime.now(UTC),
        type=EventType(draft.type) if draft.type else EventType.ONE_TIME,
        tz=draft.tz or default_tz,
        all_day=bool(draft.all_day),
        rrule=draft.rrule,
        priority=EventPriority(draft.priority)
        if draft.priority
        else EventPriority.MEDIUM,
        channels=(
            [EventChannel(c) for c in draft.channels]
            if draft.channels
            else [EventChannel.TELEGRAM]
        ),
        reminder_offsets=draft_reminder_offsets(draft, raw_input),
        tags=list(draft.tags or []),
        source=EventSource.TELEGRAM_TEXT,
        status=EventStatus.ACTIVE,
        raw_input=raw_input,
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
    logger.info(
        "Recorded Telegram inbound id=%s chat=%s msg_id=%s type=%s ref=%s",
        record.id,
        record.chat_id,
        record.telegram_message_id,
        message_type,
        redact_text(getattr(message, "text", None) or ""),
    )
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
    draft_store: DraftStore | None = None,
) -> BotReply | None:
    """Process one inbound update and return the reply to send (or None).

    Thin adapter that applies the DM-only gate and the single-user allowlist
    (ignoring group/channel/other-user noise), parses the command, dispatches
    to the pure handler and persists the inbound message. Plain (non-command)
    text is treated as an implicit ``/add`` so a natural message like
    ``"Hanging on the bar for 2 minutes each day"`` is parsed instead of
    being silently dropped. For ``/add`` (explicit or implicit) and ``/quick``
    the reply is a draft card with inline buttons (the deterministic offline
    parse happens here). Returns ``None`` when the update is ignored
    (no message, not a private chat, not the allowed user, or empty text).

    Every path is logged (content-free redacted refs only, never raw text)
    so ignored messages are analyzable instead of silent.
    """
    message = getattr(update, "effective_message", None) or getattr(
        update, "message", None
    )
    if message is None:
        logger.info("Ignoring Telegram update with no message.")
        return None
    chat = getattr(message, "chat", None)
    chat_type = getattr(chat, "type", None)
    if not is_private_chat(chat_type):
        logger.info(
            "Ignoring Telegram message from non-private chat type=%s msg_id=%s.",
            chat_type,
            getattr(message, "message_id", None),
        )
        return None
    user = getattr(message, "from_user", None)
    user_id = getattr(user, "id", None) if user is not None else None
    if not _gate_user(user_id, settings, kind="message"):
        return None

    text = getattr(message, "text", None) or ""
    message_id = getattr(message, "message_id", None)
    chat_id = getattr(chat, "id", None)
    logger.info(
        "Received Telegram DM user=%s chat=%s msg_id=%s ref=%s",
        user_id,
        chat_id,
        message_id,
        redact_text(text),
    )
    stripped = text.strip()
    command = parse_command(stripped)
    if command is None:
        if not stripped:
            logger.info(
                "Ignoring Telegram DM with empty text user=%s chat=%s msg_id=%s.",
                user_id,
                chat_id,
                message_id,
            )
            return None
        logger.info(
            "Routing plain-text Telegram DM as implicit /add user=%s chat=%s "
            "msg_id=%s ref=%s",
            user_id,
            chat_id,
            message_id,
            redact_text(stripped),
        )
        command = Command(name="add", args=stripped)
    else:
        logger.info(
            "Dispatching Telegram command /%s user=%s chat=%s msg_id=%s ref=%s",
            command.name,
            user_id,
            chat_id,
            message_id,
            redact_text(text),
        )

    events: list[Event] = []
    if session_factory is not None:
        with session_factory() as session:
            events = _active_events(session)

    result = handle_command(command, events, now=now)
    logger.info(
        "Telegram command /%s handled user=%s chat=%s msg_id=%s type=%s",
        command.name,
        user_id,
        chat_id,
        message_id,
        result.message_type,
    )

    if result.message_type in ("add_parse", "quick_parse"):
        chat_id = getattr(chat, "id", None)
        if result.message_type == "quick_parse":
            reply = _handle_quick_flow(
                result.reply,
                settings,
                now=now,
                draft_store=draft_store,
                chat_id=chat_id,
            )
        else:
            reply = _handle_add_flow(
                result.reply,
                settings,
                now=now,
                draft_store=draft_store,
                chat_id=chat_id,
            )
        if session_factory is not None:
            with session_factory() as session:
                record_inbound(session, message, "draft")
        return reply

    if session_factory is not None:
        with session_factory() as session:
            record_inbound(session, message, result.message_type)
    return BotReply(result.reply)


def _handle_quick_flow(
    text: str,
    settings: Settings,
    *,
    now: datetime | None,
    draft_store: DraftStore | None,
    chat_id: Any,
) -> BotReply:
    """Run the /quick parse flow: deterministic offline parse, always.

    Identical to the /add flow (both use ``app.quick_parse``); kept as a
    separate entry point so the dispatcher intent stays explicit.
    """
    return _handle_add_flow(
        text, settings, now=now, draft_store=draft_store, chat_id=chat_id
    )


def _handle_add_flow(
    text: str,
    settings: Settings,
    *,
    now: datetime | None,
    draft_store: DraftStore | None,
    chat_id: Any,
) -> BotReply:
    """Run the /add parse flow: deterministic offline parse, always.

    The text is parsed with ``app.quick_parse`` (no network, no key — the
    parse is instant, so no pending ack is needed). Vague text yields a
    today/all-day draft the owner corrects on the draft card (the card was
    already the confirmation step). The draft is stored in ``draft_store``
    for this chat and returned as a card with Save / Edit / Discard buttons.
    Every outcome is logged with a content-free redacted ref (never raw text).
    """
    if draft_store is None or chat_id is None:
        logger.warning(
            "Add flow with no pending state chat=%s ref=%s.",
            chat_id,
            redact_text(text),
        )
        return BotReply("Can't create the draft right now (no draft store).")
    quick = quick_parse.parse_quick_add(
        text, _as_utc(now or datetime.now(UTC)), settings.tz
    )
    draft_store.set(chat_id, PendingDraft(drafts=[quick.draft], raw_input=text))
    logger.info(
        "Add flow parsed 1 draft chat=%s ref=%s",
        chat_id,
        redact_text(text),
    )
    return BotReply(
        format_draft_card(quick.draft),
        reply_markup=[build_draft_keyboard(0)],
    )


def _handle_callback_query(
    query: Any,
    settings: Settings,
    session_factory: sessionmaker[Session] | None,
    draft_store: DraftStore | None,
    *,
    now: datetime | None = None,
    scheduler: Any | None = None,
    job_func: Callable[..., object] | None = None,
) -> BotReply | None:
    """Route a draft-button callback (Save / Edit / Discard) to its action.

    Applies the user allowlist (only allowlisted ids may act, issue #112),
    parses the callback payload, looks up the chat's pending draft and acts:
    Save persists via CRUD, Edit re-prompts for corrected text, Discard drops
    the draft. Returns ``None`` when the callback isn't a draft action or the
    user is not allowed.
    """
    user = getattr(query, "from_user", None)
    user_id = getattr(user, "id", None) if user is not None else None
    if not _gate_user(user_id, settings, kind="callback"):
        return None

    action = parse_draft_callback(getattr(query, "data", None))
    if action is None:
        logger.info(
            "Ignoring Telegram callback with bad payload user=%s data=%s.",
            user_id,
            getattr(query, "data", None),
        )
        return None

    chat = getattr(getattr(query, "message", None), "chat", None)
    chat_id = getattr(chat, "id", None)
    logger.info(
        "Received Telegram draft callback action=%s index=%d user=%s chat=%s.",
        action.action,
        action.index,
        user_id,
        chat_id,
    )
    if chat_id is None or draft_store is None:
        logger.warning(
            "Draft callback with no pending state user=%s chat=%s.", user_id, chat_id
        )
        return BotReply("No pending draft to act on.")

    pending = draft_store.get(chat_id)
    if pending is None or action.index >= len(pending.drafts):
        logger.info(
            "Draft callback no longer available user=%s chat=%s index=%d.",
            user_id,
            chat_id,
            action.index,
        )
        return BotReply("That draft is no longer available.")

    draft = pending.drafts[action.index]
    if action.action == "save":
        return _save_draft(
            session_factory,
            draft,
            pending,
            chat_id,
            draft_store,
            scheduler=scheduler,
            job_func=job_func,
            default_tz=settings.tz,
        )
    if action.action == "edit":
        logger.info("Draft callback edit re-prompt user=%s chat=%s.", user_id, chat_id)
        return BotReply(
            "✏️ Send the corrected event text (e.g. /add <text>) and I'll re-parse it."
        )
    if action.action == "discard":
        draft_store.pop(chat_id)
        logger.info("Draft discarded user=%s chat=%s.", user_id, chat_id)
        return BotReply("🗑 Draft discarded.")
    return None  # pragma: no cover — all actions are handled above


def _save_draft(
    session_factory: sessionmaker[Session] | None,
    draft: ParsedDraft,
    pending: PendingDraft,
    chat_id: Any,
    draft_store: DraftStore,
    *,
    scheduler: Any | None = None,
    job_func: Callable[..., object] | None = None,
    default_tz: str = "UTC",
) -> BotReply:
    """Persist a confirmed draft as a real (active) event; clear the pending."""
    if session_factory is None:
        logger.warning("Draft save with no database chat=%s.", chat_id)
        return BotReply("Can't save right now (no database).")
    payload = draft_to_event_create(draft, pending.raw_input, default_tz=default_tz)
    with session_factory() as session:
        event = crud.create_event(
            session, payload, scheduler=scheduler, job_func=job_func
        )
    draft_store.pop(chat_id)
    logger.info(
        "Saved Telegram draft as event id=%s chat=%s ref=%s",
        event.id,
        chat_id,
        redact_text(event.title),
    )
    return BotReply(saved_confirmation_reply(event.title))


def build_telegram_inbound_application(
    settings: Settings,
    session_factory: sessionmaker[Session] | None = None,
    *,
    now: datetime | None = None,
    draft_store: DraftStore | None = None,
    scheduler: Any | None = None,
    job_func: Callable[..., object] | None = None,
) -> Any:
    """Build the python-telegram-bot Application with an inbound DM handler.

    Returns ``None`` when no bot token is configured so the app can start
    without Telegram (same guard as the outbound sender). Registers a text
    handler for commands, a voice handler that sends the static
    not-supported reply (there is no transcription pipeline) and a
    ``CallbackQueryHandler`` for the draft buttons. The caller is responsible
    for ``run_polling()`` (the API lifespan does this).

    When a running reminder scheduler is supplied (issue #134), saved drafts
    also schedule their reminder jobs immediately instead of waiting for the
    next startup drain; ``job_func`` is the picklable job entrypoint to use
    (defaults to the outbound module's ``telegram_reminder_job``).
    """
    if not settings.telegram_bot_token:
        return None
    from telegram.ext import (
        Application,
        CallbackQueryHandler,
        MessageHandler,
        filters,
    )

    if scheduler is not None and job_func is None:
        # The picklable entrypoint persisted with every job; the outbound
        # module registers its live dispatcher in the job-func registry.
        job_func = telegram_reminder_job
    app = Application.builder().token(settings.telegram_bot_token).build()
    if draft_store is None:
        draft_store = DraftStore()

    async def handler(update: Any, _context: Any) -> None:
        message = getattr(update, "effective_message", None) or getattr(
            update, "message", None
        )
        # Off the event loop: _handle_update does blocking DB I/O; this loop
        # also serves the FastAPI web endpoints, so it must not block.
        reply = await asyncio.to_thread(
            _handle_update,
            update,
            settings,
            session_factory,
            now=now,
            draft_store=draft_store,
        )
        if reply is None:
            return
        if message is not None:
            await _send_reply_with_retry(message.reply_text, reply)

    async def voice_not_supported_handler(update: Any, _context: Any) -> None:
        # Voice messages are not supported (no transcription pipeline): send
        # the static reply. Same DM-only + allowlist gates as text commands.
        message = getattr(update, "effective_message", None) or getattr(
            update, "message", None
        )
        if message is None:
            return
        chat = getattr(message, "chat", None)
        if not is_private_chat(getattr(chat, "type", None)):
            logger.info(
                "Ignoring Telegram voice message from non-private chat type=%s.",
                getattr(chat, "type", None),
            )
            return
        user = getattr(message, "from_user", None)
        user_id = getattr(user, "id", None) if user is not None else None
        if not _gate_user(user_id, settings, kind="voice message"):
            return
        sender = getattr(message, "reply_text", None)
        if sender is not None:
            await _send_text_with_retry(sender, voice_not_supported())

    async def callback_handler(update: Any, _context: Any) -> None:
        query = getattr(update, "callback_query", None)
        if query is None:
            return
        # Off the event loop like the other handlers: the save path does
        # blocking DB commits + scheduler work on the shared loop.
        reply = await asyncio.to_thread(
            _handle_callback_query,
            query,
            settings,
            session_factory,
            draft_store,
            now=now,
            scheduler=scheduler,
            job_func=job_func,
        )
        if reply is None:
            return
        sender = getattr(query, "answer", None)
        if sender is not None:
            with contextlib.suppress(Exception):
                try:
                    await sender()
                except Exception:
                    logger.warning(
                        "Telegram callback answer failed (non-fatal).",
                        exc_info=True,
                    )
        message = getattr(query, "message", None)
        if message is not None:
            await _send_reply_with_retry(message.reply_text, reply)

    async def _on_error(update: Any, context: Any) -> None:
        """Log an unhandled Telegram update error loudly (never silent)."""
        err = getattr(context, "error", None)
        logger.error(
            "Telegram update failed: %s (update=%r)",
            err,
            getattr(update, "update_id", update),
            exc_info=err if isinstance(err, BaseException) else None,
        )

    app.add_handler(MessageHandler(filters.TEXT, handler))
    app.add_handler(MessageHandler(filters.VOICE, voice_not_supported_handler))
    app.add_handler(CallbackQueryHandler(callback_handler))
    app.add_error_handler(_on_error)
    return app


async def _send_reply(reply_text: Any, reply: BotReply) -> None:
    """Send a ``BotReply`` as a Telegram message (thin adapter)."""
    if reply.reply_markup is None:
        await reply_text(reply.text)
        return
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    rows = [
        [InlineKeyboardButton(label, callback_data=data) for label, data in row]
        for row in reply.reply_markup
    ]
    await reply_text(reply.text, reply_markup=InlineKeyboardMarkup(rows))


async def _send_reply_with_retry(reply_text: Any, reply: BotReply) -> bool:
    """Send a ``BotReply``, retrying transient network failures.

    Retries :data:`_REPLY_MAX_ATTEMPTS` times with a linear backoff so a
    single TLS/connection blip (the 2026-10-12 ``httpx.ConnectError`` that
    made ``/add`` look dead) does not silently drop the reply. Every failure
    is logged; the final failure is logged as an error (with traceback) and
    ``False`` is returned instead of raising, so the polling loop keeps
    running and the pending draft stays in the store for a resend.
    Returns ``True`` when the send succeeded.
    """
    last_exc: BaseException | None = None
    for attempt in range(1, _REPLY_MAX_ATTEMPTS + 1):
        try:
            await _send_reply(reply_text, reply)
            return True
        except Exception as exc:  # noqa: BLE001 — retry transient sends
            last_exc = exc
            if attempt >= _REPLY_MAX_ATTEMPTS:
                break
            logger.warning(
                "Telegram reply send failed (attempt %d/%d: %s); retrying.",
                attempt,
                _REPLY_MAX_ATTEMPTS,
                exc,
            )
            await asyncio.sleep(_REPLY_RETRY_BASE_DELAY_SEC * attempt)
    logger.error(
        "Telegram reply send failed after %d attempts: %s",
        _REPLY_MAX_ATTEMPTS,
        last_exc,
        exc_info=last_exc if isinstance(last_exc, BaseException) else None,
    )
    return False


async def _send_text_with_retry(sender: Any, text: str) -> bool:
    """Send plain text via ``sender``, retrying transient failures (see above)."""
    last_exc: BaseException | None = None
    for attempt in range(1, _REPLY_MAX_ATTEMPTS + 1):
        try:
            await sender(text)
            return True
        except Exception as exc:  # noqa: BLE001 — retry transient sends
            last_exc = exc
            if attempt >= _REPLY_MAX_ATTEMPTS:
                break
            logger.warning(
                "Telegram text send failed (attempt %d/%d: %s); retrying.",
                attempt,
                _REPLY_MAX_ATTEMPTS,
                exc,
            )
            await asyncio.sleep(_REPLY_RETRY_BASE_DELAY_SEC * attempt)
    logger.error(
        "Telegram text send failed after %d attempts: %s",
        _REPLY_MAX_ATTEMPTS,
        last_exc,
        exc_info=last_exc if isinstance(last_exc, BaseException) else None,
    )
    return False
