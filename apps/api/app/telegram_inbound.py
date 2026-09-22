"""Telegram inbound DM command bot (issue #69, M5-T1).

A python-telegram-bot v21 polling updater (consistent with
``telegram_outbound.py``) that answers the owner's private-chat commands:

- ``/today`` — list today's events.
- ``/upcoming [7d|30d]`` — list upcoming events (default 7 days).
- ``/low`` — list low-priority events on demand.
- ``/add <text>`` — smart parse → draft flow: first try the deterministic
  offline parser (``app.quick_parse`` — dates, times, reminders like ``1h``,
  priorities, recurrence words); when the text names an explicit date or time
  the draft card is instant (no network, no LLM key needed). Vague text
  without any date/time falls back to the AI parse → draft flow (issue #75,
  M5-T4A): parse via ``llm_parse.parse_events`` (the same pure module the
  ``POST /api/events/parse`` endpoint reuses). Either way each parsed draft
  is presented as a Telegram card with inline **Save / Edit / Discard**
  buttons, and only persisted (via the CRUD layer) when the owner taps
  **Save**.
- ``/quick <text>`` — always parse deterministically offline
  (``app.quick_parse``; today is the default date) and present the same
  Save / Edit / Discard draft card. Never touches the network.
  Plain (non-command) text is treated as an implicit ``/add`` so a natural
  message is parsed instead of being silently dropped; the bot first replies
  with a pending ack (``pending_add_reply``) because the LLM fallback can take
  seconds, then sends the draft card, and replies with a ``✅ Saved``
  confirmation (``saved_confirmation_reply``) when the draft is saved.
- **voice messages** — transcribed locally (``app.stt``: ffmpeg → voxtype,
  issue #71) and routed through the same parse → draft flow as ``/add``
  (issue #111). When local STT is unavailable (e.g. the Docker image ships no
  voxtype/whisper) the sender gets a clear "voice transcription unavailable"
  reply instead of silence.
- ``/ask <question>`` — LLM query over history. The query endpoint is not
  merged yet, so this is a **stub**, wired when available.

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
pending-ack helpers (``pending_add_reply`` / ``voice_pending_reply`` /
``saved_confirmation_reply`` / ``is_add_flow_text``), the inbound-record
builder (``build_inbound_record``) and the draft-flow helpers
(``format_draft_card`` / ``format_draft_when`` / ``build_draft_keyboard`` /
``parse_draft_callback`` / ``draft_to_event_create`` / ``DraftStore``) and
the voice replies
(``voice_unavailable_reply`` / ``voice_error_reply``). The impure Telegram
wiring (``_handle_update`` / ``_handle_voice_update`` /
``_handle_callback_query`` / ``build_telegram_inbound_application`` /
``record_inbound``) is a thin adapter over python-telegram-bot v21 (polling)
and is kept to a minimum.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session, sessionmaker

from . import crud, quick_parse
from .config import Settings
from .enums import EventChannel, EventPriority, EventSource, EventStatus, EventType
from .llm_parse import (
    ParsedDraft,
    extract_reminder_offsets_from_text,
    normalize_reminder_offset,
    parse_events,
)
from .models import Event, TelegramInbound
from .recurrence import Occurrence, next_occurrences
from .redaction import redact_text
from .schemas import EventCreate
from .stt import SttResult, run_command, transcribe_voice
from .telegram_outbound import priority_emoji, telegram_reminder_job

logger = logging.getLogger(__name__)


class VoiceTranscriber(Protocol):
    """The local transcription callable the voice handler uses (``app.stt``).

    A *blocking* callable (``subprocess.run`` for ffmpeg/voxtype, up to 300s);
    the voice handler must dispatch it off the asyncio event loop
    (``asyncio.to_thread``) so the shared API process stays responsive
    (issue #132).
    """

    def __call__(
        self, ogg_path: str, duration_seconds: float | None, settings: Settings
    ) -> SttResult:
        """Transcribe a downloaded voice file locally (no network)."""
        ...


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
    (active) ``events``; ``/add`` runs the smart (deterministic-first) parse
    flow and ``/quick`` the deterministic-only flow (the thin adapter performs
    the parse and presents the draft card); ``/ask`` is a stub until the
    query endpoint (issue #70) is merged. Unknown commands get a usage hint.
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
    if command.name == "ask":
        return _reply_ask(command.args)
    return CommandResult(
        reply=(
            "Unknown command. Try /today, /upcoming [7d|30d], /low, "
            "/add <text>, /quick <text> or /ask <question>."
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


def voice_unavailable_reply() -> str:
    """Clear reply when local STT is unavailable (pure).

    The Docker image ships no voxtype/whisper (or ffmpeg), so a voice message
    can never be transcribed there. The reply says so explicitly instead of
    failing silently (issue #111) and points at the text path and the
    native-run voice path documented in the README.
    """
    return (
        "🎙 Voice transcription isn't available in this deployment "
        "(no local voxtype/whisper installed). Send the event as text with "
        "/add <text> instead — for voice, run the API natively (see README)."
    )


def voice_error_reply(error: str | None) -> str:
    """Reply for a voice message that failed to download/transcribe (pure)."""
    detail = (error or "unknown error").strip()
    return f"🎙 Couldn't transcribe the voice message: {detail}"


def pending_add_reply() -> str:
    """Immediate ack sent before the (slow) LLM parse runs (pure).

    Parsing can take many seconds (gateway retries with backoff), so the bot
    sends this first — the caller then sends the draft card (or the parse
    error) as a second message once parsing finishes.
    """
    return "⏳ Got it — parsing your event, one moment… I'll send the draft card next."


def voice_pending_reply() -> str:
    """Immediate ack sent before a voice message is downloaded/transcribed."""
    return "🎙 Got your voice message — transcribing now, one moment…"


def saved_confirmation_reply(title: str) -> str:
    """Confirmation sent when a draft is saved as an event (pure)."""
    return f"✅ Saved: {title}"


def is_add_flow_text(text: str | None) -> bool:
    """Whether a text message will run the add parse flow (pure).

    True for ``/add <non-empty text>``, ``/quick <non-empty text>`` and for
    plain (non-command) text — plain DMs are treated as implicit ``/add`` so
    sending e.g. ``"Hanging on the bar for 2 minutes each day"`` just works
    instead of being silently ignored. Fast commands (``/today`` …) return
    False.
    """
    if not text or not text.strip():
        return False
    command = parse_command(text.strip())
    if command is None:
        return True
    return command.name in ("add", "quick") and bool(command.args.strip())


def wants_pending_for_text_update(update: Any, settings: Settings) -> bool:
    """Peek whether the text handler should send a pending ack first (pure).

    Mirrors the DM-only + allowlist gates of :func:`_handle_update` without
    any I/O: only an allowlisted private-chat message that will run the
    (possibly slow, LLM-backed) ``/add`` flow gets a pending message.
    ``/quick`` is always instant (deterministic offline parse) so it never
    gets one, and fast commands and ignored updates never get one.
    """
    message = getattr(update, "effective_message", None) or getattr(
        update, "message", None
    )
    if message is None:
        return False
    if not is_private_chat(getattr(getattr(message, "chat", None), "type", None)):
        return False
    user = getattr(message, "from_user", None)
    user_id = getattr(user, "id", None) if user is not None else None
    if not settings.telegram_allowlist.allows(user_id):
        return False
    text = getattr(message, "text", None)
    if not is_add_flow_text(text):
        return False
    command = parse_command((text or "").strip())
    return command is None or command.name != "quick"


def wants_pending_for_voice_update(update: Any, settings: Settings) -> bool:
    """Peek whether the voice handler should send a pending ack first (pure)."""
    message = getattr(update, "effective_message", None) or getattr(
        update, "message", None
    )
    if message is None:
        return False
    if not is_private_chat(getattr(getattr(message, "chat", None), "type", None)):
        return False
    user = getattr(message, "from_user", None)
    user_id = getattr(user, "id", None) if user is not None else None
    if not settings.telegram_allowlist.allows(user_id):
        return False
    voice = getattr(message, "voice", None)
    if voice is None:
        return False
    return getattr(voice, "file_id", None) is not None


def _reply_add(args: str) -> CommandResult:
    """Handle /add: empty text gets a usage hint; otherwise mark for parsing.

    The actual parse is impure (deterministic first, LLM fallback over HTTP),
    so the command dispatcher returns the stripped text with
    ``message_type="add_parse"`` and the thin adapter (``_handle_update``)
    performs the parse and presents the draft card.
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
                "instantly offline; vague text falls back to AI. "
                "/quick <text> always parses offline (today by default)."
            ),
            message_type="text",
        )
    return CommandResult(reply=text, message_type="add_parse")


def _reply_quick(args: str) -> CommandResult:
    """Handle /quick: empty text gets a usage hint; otherwise mark for parsing.

    Like :func:`_reply_add` but the adapter always parses deterministically
    offline (``message_type="quick_parse"``) — never the LLM.
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

    Shows the title plus any fields the model was confident about (start time,
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

    Prefers the model's normalized ``reminder_offsets``; when the model gave
    none (or only invalid ones), falls back to explicit lead-time phrases in
    the raw text (*"15 minutes in advance"* → ``["15m"]``) so a spoken reminder
    request is never silently dropped. Returns ``[]`` when neither source names
    a lead time.
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
    http_client: Any | None = None,
    draft_store: DraftStore | None = None,
) -> BotReply | None:
    """Process one inbound update and return the reply to send (or None).

    Thin adapter that applies the DM-only gate and the single-user allowlist
    (ignoring group/channel/other-user noise), parses the command, dispatches
    to the pure handler and persists the inbound message. Plain (non-command)
    text is treated as an implicit ``/add`` so a natural message like
    ``"Hanging on the bar for 2 minutes each day"`` is parsed instead of
    being silently dropped. For ``/add`` (explicit or implicit) the reply is
    a draft card with inline buttons (the LLM parse is impure, so it happens
    here via ``http_client``). Returns ``None`` when the update is ignored
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
                http_client=http_client,
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


def _quick_card_reply(
    text: str,
    settings: Settings,
    *,
    now: datetime | None,
    draft_store: DraftStore | None,
    chat_id: Any,
) -> BotReply | None:
    """Try the deterministic offline parse; store + render the card on success.

    Returns the card reply when the text names an explicit date or time, else
    ``None`` so the caller can fall back to the LLM. Needs only the draft
    store (no network, no LLM key). Shared by ``/add`` (explicit dates only)
    and ``/quick`` (forced by the caller via ``force=True``).
    """
    if draft_store is None or chat_id is None:
        return None
    quick = quick_parse.parse_quick_add(
        text, _as_utc(now or datetime.now(UTC)), settings.tz
    )
    if not quick.has_explicit_date and not quick.has_explicit_time:
        return None
    draft_store.set(chat_id, PendingDraft(drafts=[quick.draft], raw_input=text))
    logger.info(
        "Quick parse produced 1 draft chat=%s ref=%s",
        chat_id,
        redact_text(text),
    )
    return BotReply(
        format_draft_card(quick.draft),
        reply_markup=[build_draft_keyboard(0)],
    )


def _handle_quick_flow(
    text: str,
    settings: Settings,
    *,
    now: datetime | None,
    draft_store: DraftStore | None,
    chat_id: Any,
) -> BotReply:
    """Run the /quick parse flow: deterministic offline parse, always.

    Never touches the network: the text is parsed with ``app.quick_parse``
    (today is the default date), stored as the chat's pending draft and
    returned as a Save / Edit / Discard card. Every outcome is logged with a
    content-free redacted ref (never raw text).
    """
    if draft_store is None or chat_id is None:
        logger.warning(
            "Quick flow with no pending state chat=%s ref=%s.",
            chat_id,
            redact_text(text),
        )
        return BotReply("Can't create the draft right now (no draft store).")
    quick = quick_parse.parse_quick_add(
        text, _as_utc(now or datetime.now(UTC)), settings.tz
    )
    draft_store.set(chat_id, PendingDraft(drafts=[quick.draft], raw_input=text))
    logger.info(
        "Quick flow parsed 1 draft chat=%s ref=%s",
        chat_id,
        redact_text(text),
    )
    return BotReply(
        format_draft_card(quick.draft),
        reply_markup=[build_draft_keyboard(0)],
    )


def _handle_add_flow(
    text: str,
    settings: Settings,
    *,
    now: datetime | None,
    http_client: Any | None,
    draft_store: DraftStore | None,
    chat_id: Any,
) -> BotReply:
    """Run the /add parse flow: quick offline parse first, LLM fallback.

    When the text names an explicit date or time the deterministic offline
    parser (``app.quick_parse``) produces the draft card instantly (no
    network, no LLM key). Otherwise falls back to ``parse_events`` via
    ``http_client``. On success the parsed draft(s) are stored in
    ``draft_store`` for this chat and returned as a card with Save / Edit /
    Discard buttons. Failures (no LLM key, transport error, clarification
    needed) return a plain text reply and store nothing. Every outcome is
    logged with a content-free redacted ref (never raw text).
    """
    quick_reply = _quick_card_reply(
        text, settings, now=now, draft_store=draft_store, chat_id=chat_id
    )
    if quick_reply is not None:
        return quick_reply

    if http_client is None or draft_store is None or chat_id is None:
        logger.warning(
            "Add flow unavailable chat=%s ref=%s (missing client/store/chat).",
            chat_id,
            redact_text(text),
        )
        return BotReply("AI parsing isn't available right now.")

    logger.info("Add flow parsing started chat=%s ref=%s", chat_id, redact_text(text))
    result = parse_events(
        text=text,
        now=_as_utc(now or datetime.now(UTC)),
        tz=settings.tz,
        settings=settings,
        http_client=http_client,
    )
    if result.unavailable:
        logger.warning(
            "Add flow unavailable (no LLM key) chat=%s ref=%s",
            chat_id,
            redact_text(text),
        )
        return BotReply(
            "AI parsing isn't configured (no LLM key). "
            "Add the event manually in the web app for now."
        )
    if not result.ok or result.outcome is None:
        logger.warning(
            "Add flow parse failed chat=%s ref=%s error=%s",
            chat_id,
            redact_text(text),
            result.error or "unknown error",
        )
        return BotReply(f"Couldn't parse that: {result.error or 'unknown error'}")
    if result.outcome.needs_clarification:
        logger.info(
            "Add flow needs clarification chat=%s ref=%s", chat_id, redact_text(text)
        )
        return BotReply(result.outcome.clarification or "Need more details.")

    drafts = result.outcome.drafts or []

    draft_store.set(chat_id, PendingDraft(drafts=drafts, raw_input=text))
    logger.info(
        "Add flow parsed %d draft(s) chat=%s ref=%s",
        len(drafts),
        chat_id,
        redact_text(text),
    )
    card_text = "\n\n".join(format_draft_card(d) for d in drafts)
    keyboard_rows = [build_draft_keyboard(i) for i in range(len(drafts))]
    return BotReply(card_text, reply_markup=keyboard_rows)


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


async def _download_voice_file(bot: Any, file_id: str) -> str:
    """Download a Telegram voice file to a temp path (thin adapter).

    The file is fetched through the bot's API into a temporary ``.ogg`` path
    that the local STT pipeline (ffmpeg → voxtype) can read. The caller owns
    deleting the file.
    """
    telegram_file = await bot.get_file(file_id)
    fd, path = tempfile.mkstemp(prefix="timeline-voice-", suffix=".ogg")
    os.close(fd)
    try:
        await telegram_file.download_to_drive(path)
    except Exception:
        with contextlib.suppress(OSError):
            os.unlink(path)
        raise
    return path


def _run_local_transcription(
    ogg_path: str, duration_seconds: float | None, settings: Settings
) -> SttResult:
    """Run the real local transcription pipeline (ffmpeg + voxtype subprocesses)."""
    return transcribe_voice(ogg_path, duration_seconds, settings, run_command)


async def _transcribe_voice_message(
    bot: Any,
    file_id: str,
    duration: float | None,
    settings: Settings,
    *,
    transcribe: VoiceTranscriber | None = None,
) -> SttResult:
    """Download a voice file and transcribe it locally (thin adapter).

    Downloads the file via ``bot`` and runs the local transcription pipeline
    (``app.stt.transcribe_voice`` with the real subprocess runner) — ffmpeg +
    voxtype only, never a network command. ``transcribe`` is injectable so
    tests can fake transcription without any subprocess. The temp file is
    always removed afterwards.

    The transcription is a *blocking* call (``subprocess.run`` inside
    ``app.stt.run_command``, up to the 300s timeout), so it is dispatched off
    the asyncio event loop via ``asyncio.to_thread`` (issue #132): the same
    loop serves the FastAPI web endpoints, and running the local STT pipeline
    inline used to freeze the whole API for the duration of the transcription.
    """
    runner: VoiceTranscriber = (
        transcribe if transcribe is not None else _run_local_transcription
    )
    ogg_path = await _download_voice_file(bot, file_id)
    try:
        # Off the event loop: ffmpeg/whisper block for seconds (up to the 300s
        # subprocess timeout) and this loop also serves the web API (#132).
        return await asyncio.to_thread(runner, ogg_path, duration, settings)
    finally:
        with contextlib.suppress(OSError):
            os.unlink(ogg_path)


async def _handle_voice_update(
    update: Any,
    settings: Settings,
    session_factory: sessionmaker[Session] | None = None,
    *,
    bot: Any | None = None,
    now: datetime | None = None,
    http_client: Any | None = None,
    draft_store: DraftStore | None = None,
    transcribe: VoiceTranscriber | None = None,
) -> BotReply | None:
    """Process one inbound voice update: transcribe locally, then parse (issue #111).

    Applies the same DM-only + allowlist gates as text commands, downloads the
    voice file via ``bot`` and transcribes it locally (``app.stt``). When local
    STT is unavailable (e.g. the Docker image ships no voxtype/whisper) the
    sender gets a clear "voice transcription unavailable" reply instead of
    silence. A successful transcription is routed through the same /add parse →
    draft-card flow as text. Returns ``None`` when the update is ignored.
    """
    message = getattr(update, "effective_message", None) or getattr(
        update, "message", None
    )
    if message is None:
        logger.info("Ignoring Telegram voice update with no message.")
        return None
    if not is_private_chat(getattr(getattr(message, "chat", None), "type", None)):
        logger.info(
            "Ignoring Telegram voice message from non-private chat type=%s msg_id=%s.",
            getattr(getattr(message, "chat", None), "type", None),
            getattr(message, "message_id", None),
        )
        return None
    user = getattr(message, "from_user", None)
    user_id = getattr(user, "id", None) if user is not None else None
    if not _gate_user(user_id, settings, kind="voice message"):
        return None

    voice = getattr(message, "voice", None)
    if voice is None:
        logger.info(
            "Ignoring non-voice update in voice handler user=%s chat=%s msg_id=%s.",
            user_id,
            getattr(getattr(message, "chat", None), "id", None),
            getattr(message, "message_id", None),
        )
        return None
    file_id = getattr(voice, "file_id", None)
    if file_id is None or bot is None:
        logger.warning(
            "Voice message with unavailable file user=%s chat=%s msg_id=%s.",
            user_id,
            getattr(getattr(message, "chat", None), "id", None),
            getattr(message, "message_id", None),
        )
        return BotReply(voice_error_reply("voice file is unavailable"))

    logger.info(
        "Received Telegram voice message user=%s chat=%s msg_id=%s duration=%s.",
        user_id,
        getattr(getattr(message, "chat", None), "id", None),
        getattr(message, "message_id", None),
        getattr(voice, "duration", None),
    )
    try:
        result = await _transcribe_voice_message(
            bot,
            file_id,
            getattr(voice, "duration", None),
            settings,
            transcribe=transcribe,
        )
    except Exception as exc:  # noqa: BLE001 — reply instead of silence (issue #111)
        logger.warning("Voice message transcription failed: %s", exc)
        return BotReply(voice_error_reply(str(exc) or type(exc).__name__))
    if result.unavailable:
        chat_id = getattr(getattr(message, "chat", None), "id", None)
        logger.warning(
            "Voice transcription unavailable user=%s chat=%s.",
            user_id,
            chat_id,
        )
        return BotReply(voice_unavailable_reply())
    if not result.ok or not result.text:
        logger.warning(
            "Voice transcription failed user=%s chat=%s error=%s.",
            user_id,
            getattr(getattr(message, "chat", None), "id", None),
            result.error,
        )
        return BotReply(voice_error_reply(result.error))

    logger.info(
        "Voice transcribed user=%s chat=%s ref=%s",
        user_id,
        getattr(getattr(message, "chat", None), "id", None),
        redact_text(result.text),
    )
    chat = getattr(message, "chat", None)
    chat_id = getattr(chat, "id", None)
    # Off the event loop: the LLM parse is blocking (sync httpx + retry
    # sleeps) and this loop also serves the web API — parsing inline froze
    # the whole API for the duration of the parse.
    reply = await asyncio.to_thread(
        _handle_add_flow,
        result.text,
        settings,
        now=now,
        http_client=http_client,
        draft_store=draft_store,
        chat_id=chat_id,
    )
    if session_factory is not None:
        with session_factory() as session:
            record_inbound(session, message, "draft")
    return reply


def build_telegram_inbound_application(
    settings: Settings,
    session_factory: sessionmaker[Session] | None = None,
    *,
    now: datetime | None = None,
    http_client: Any | None = None,
    draft_store: DraftStore | None = None,
    transcribe: VoiceTranscriber | None = None,
    scheduler: Any | None = None,
    job_func: Callable[..., object] | None = None,
) -> Any:
    """Build the python-telegram-bot Application with an inbound DM handler.

    Returns ``None`` when no bot token is configured so the app can start
    without Telegram (same guard as the outbound sender). Registers a text
    handler for commands, a voice handler (local transcription → parse flow,
    issue #111) and a ``CallbackQueryHandler`` for the draft buttons. The
    caller is responsible for ``run_polling()`` (the API lifespan does this).

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
    if http_client is None:
        import httpx

        http_client = httpx.Client(timeout=30.0)
    if draft_store is None:
        draft_store = DraftStore()

    async def handler(update: Any, _context: Any) -> None:
        message = getattr(update, "effective_message", None) or getattr(
            update, "message", None
        )
        if message is not None and wants_pending_for_text_update(update, settings):
            sender = getattr(message, "reply_text", None)
            if sender is not None:
                with contextlib.suppress(Exception):
                    await sender(pending_add_reply())
        # Off the event loop: _handle_update runs the blocking LLM parse
        # (sync httpx + retry sleeps) and blocking DB I/O; this loop also
        # serves the FastAPI web endpoints, and parsing inline froze the
        # whole API (no data fetching) until the parse finished.
        reply = await asyncio.to_thread(
            _handle_update,
            update,
            settings,
            session_factory,
            now=now,
            http_client=http_client,
            draft_store=draft_store,
        )
        if reply is None:
            return
        if message is not None:
            await _send_reply(message.reply_text, reply)

    async def voice_handler(update: Any, context: Any) -> None:
        message = getattr(update, "effective_message", None) or getattr(
            update, "message", None
        )
        if message is not None and wants_pending_for_voice_update(update, settings):
            sender = getattr(message, "reply_text", None)
            if sender is not None:
                with contextlib.suppress(Exception):
                    await sender(voice_pending_reply())
        reply = await _handle_voice_update(
            update,
            settings,
            session_factory,
            bot=getattr(context, "bot", None),
            now=now,
            http_client=http_client,
            draft_store=draft_store,
            transcribe=transcribe,
        )
        if reply is None:
            return
        if message is not None:
            await _send_reply(message.reply_text, reply)

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
            await sender()
        message = getattr(query, "message", None)
        if message is not None:
            await _send_reply(message.reply_text, reply)

    app.add_handler(MessageHandler(filters.TEXT, handler))
    app.add_handler(MessageHandler(filters.VOICE, voice_handler))
    app.add_handler(CallbackQueryHandler(callback_handler))
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
