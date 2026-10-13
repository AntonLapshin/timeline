"""Tests for the Telegram inbound DM command bot (issue #69, M5-T1).

Covers the acceptance criteria:

- **DM-only gate**: ``is_private_chat`` accepts only private chats; groups,
  supergroups and channels are ignored.
- **Allowlist rejection**: ``_handle_update`` ignores messages from users not
  on the allowlist (``TELEGRAM_USER_IDS`` combined with the legacy
  ``TELEGRAM_USER_ID``, issue #112) and from non-private chats.
- **Commands**: ``/today``, ``/upcoming [7d|30d]``, ``/low``, ``/add <text>``
  and ``/quick <text>`` (both deterministic-only) each produce the expected
  reply; unknown commands get a usage hint.
- **Voice messages**: voice input is not supported — a voice message gets the
  static ``voice_not_supported`` reply.
- **No-token no-op**: ``build_telegram_inbound_application`` returns ``None``
  with no bot token (never polls).
"""

from __future__ import annotations

import contextlib
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.enums import (
    EventChannel,
    EventPriority,
    EventSource,
    EventStatus,
    EventType,
)
from app.models import Event, TelegramInbound
from app.quick_parse import ParsedDraft
from app.telegram_inbound import (
    BotReply,
    Command,
    DraftAction,
    DraftStore,
    PendingDraft,
    _handle_callback_query,
    _handle_reminder_callback_query,
    _handle_update,
    _save_draft,
    _send_reply_with_retry,
    _send_text_with_retry,
    build_draft_keyboard,
    build_inbound_record,
    build_telegram_inbound_application,
    draft_to_event_create,
    events_low,
    events_today,
    events_upcoming,
    format_draft_card,
    format_draft_when,
    format_event_line,
    handle_command,
    is_private_chat,
    parse_command,
    parse_draft_callback,
    parse_upcoming_days,
    record_inbound,
    voice_not_supported,
)


@pytest.fixture()
def session_factory(tmp_path: Path) -> sessionmaker[Session]:
    """A session factory over an isolated temp DB."""
    settings = Settings(data_dir=tmp_path, db_name="inbound.db")
    engine = create_engine_from_settings(settings)
    models.Base.metadata.create_all(engine)
    return make_session_factory(engine)


def _event(**overrides: object) -> Event:
    """Build a minimal valid active Event."""
    values: dict[str, object] = {
        "title": "Team standup",
        "description": "",
        "type": EventType.ONE_TIME,
        "start_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        "tz": "UTC",
        "priority": EventPriority.MEDIUM,
        "source": EventSource.WEB,
        "status": EventStatus.ACTIVE,
        "reminder_offsets": ["1h"],
    }
    values.update(overrides)
    return Event(**values)


def _now() -> datetime:
    return datetime(2026, 1, 1, 8, 30, tzinfo=UTC)


# --- DM-only gate ------------------------------------------------------------


def test_is_private_chat() -> None:
    """Only private chats pass the DM-only gate."""
    assert is_private_chat("private") is True
    assert is_private_chat("group") is False
    assert is_private_chat("supergroup") is False
    assert is_private_chat("channel") is False
    assert is_private_chat(None) is False


# --- command parsing ----------------------------------------------------------


def test_parse_command() -> None:
    """A /command parses into a name and its trailing args."""
    assert parse_command("/today") == Command("today", "")
    assert parse_command("/upcoming 30d") == Command("upcoming", "30d")
    assert parse_command("/add dentist tomorrow 9am") == Command(
        "add", "dentist tomorrow 9am"
    )
    assert parse_command("/Today") == Command("today", "")
    assert parse_command("/ask when is my next dentist") == Command(
        "ask", "when is my next dentist"
    )


def test_parse_command_non_command() -> None:
    """Plain text (not starting with /) is not a command."""
    assert parse_command("") is None
    assert parse_command("hello there") is None
    assert parse_command("   ") is None


def test_parse_upcoming_days() -> None:
    """The /upcoming day argument is parsed and validated."""
    assert parse_upcoming_days("") == 7
    assert parse_upcoming_days("7d") == 7
    assert parse_upcoming_days("30d") == 30
    assert parse_upcoming_days("7") == 7
    # Only 7/30 accepted; anything else is invalid.
    assert parse_upcoming_days("14d") is None
    assert parse_upcoming_days("abc") is None
    assert parse_upcoming_days("0") is None


# --- event listing helpers ----------------------------------------------------


def test_events_today_finds_todays_occurrence() -> None:
    """An event occurring today is listed by /today."""
    event = _event(start_at=_now() + timedelta(hours=1))
    items = events_today([event], _now())
    assert len(items) == 1
    assert items[0][0] is event


def test_events_today_skips_other_days() -> None:
    """An event not occurring today is not listed by /today."""
    tomorrow = _event(start_at=_now() + timedelta(days=2))
    assert events_today([tomorrow], _now()) == []


def test_events_today_naive_now_treated_as_utc() -> None:
    """A naive ``now`` is interpreted as UTC (defensive ``_as_utc`` branch)."""
    event = _event(start_at=_now() + timedelta(hours=1))
    naive_now = _now().replace(tzinfo=None)
    assert naive_now.tzinfo is None
    items = events_today([event], naive_now)
    assert len(items) == 1
    assert items[0][0] is event


def test_events_today_recurrent() -> None:
    """A daily recurrent event is listed by /today."""
    event = _event(start_at=_now() - timedelta(days=10), rrule="FREQ=DAILY;COUNT=30")
    items = events_today([event], _now())
    assert len(items) == 1
    assert items[0][1].start.astimezone(UTC).date() == _now().date()


def test_events_upcoming_within_horizon() -> None:
    """An event within the horizon is listed by /upcoming."""
    event = _event(start_at=_now() + timedelta(days=3))
    items = events_upcoming([event], _now(), 7)
    assert len(items) == 1
    assert items[0][0] is event


def test_events_upcoming_beyond_horizon() -> None:
    """An event beyond the horizon is not listed by /upcoming."""
    event = _event(start_at=_now() + timedelta(days=20))
    assert events_upcoming([event], _now(), 7) == []
    assert len(events_upcoming([event], _now(), 30)) == 1


def test_events_low_only_low_priority() -> None:
    """/low lists only low-priority events."""
    low = _event(priority=EventPriority.LOW, start_at=_now() + timedelta(days=1))
    medium = _event(priority=EventPriority.MEDIUM, start_at=_now() + timedelta(hours=1))
    items = events_low([low, medium], _now())
    assert len(items) == 1
    assert items[0][0] is low


# --- formatting ---------------------------------------------------------------


def test_format_event_line_with_date() -> None:
    """A line includes the priority emoji, title, date and time."""
    event = _event(title="Dentist", start_at=_now() + timedelta(hours=1))
    occ = events_today([event], _now())[0][1]
    line = format_event_line(event, occ, include_date=True)
    assert "⏰" in line
    assert "Dentist" in line
    assert "Jan 01" in line


def test_format_event_line_all_day() -> None:
    """An all-day event shows 'All day' instead of a time."""
    event = _event(all_day=True, start_at=_now() + timedelta(hours=1))
    occ = events_today([event], _now())[0][1]
    line = format_event_line(event, occ, include_date=False)
    assert "All day" in line


# --- command dispatch ---------------------------------------------------------


def test_handle_command_today() -> None:
    """/today lists today's events."""
    event = _event(start_at=_now() + timedelta(hours=1))
    result = handle_command(Command("today", ""), [event], now=_now())
    assert result.message_type == "text"
    assert "📅 Today" in result.reply
    assert "Team standup" in result.reply


def test_handle_command_today_empty() -> None:
    """/today with no events says so."""
    result = handle_command(Command("today", ""), [], now=_now())
    assert result.reply == "No events today."


def test_handle_command_upcoming_default() -> None:
    """/upcoming defaults to 7 days."""
    event = _event(start_at=_now() + timedelta(days=3))
    result = handle_command(Command("upcoming", ""), [event], now=_now())
    assert "Upcoming 7 days" in result.reply
    assert "Team standup" in result.reply


def test_handle_command_upcoming_30d() -> None:
    """/upcoming 30d lists events within 30 days."""
    event = _event(start_at=_now() + timedelta(days=20))
    result = handle_command(Command("upcoming", "30d"), [event], now=_now())
    assert "Upcoming 30 days" in result.reply
    assert "Team standup" in result.reply


def test_handle_command_upcoming_invalid() -> None:
    """/upcoming with an invalid argument returns a usage hint."""
    result = handle_command(Command("upcoming", "14d"), [], now=_now())
    assert "Usage: /upcoming [7d|30d]" in result.reply


def test_handle_command_upcoming_empty() -> None:
    """/upcoming with nothing in range says so."""
    result = handle_command(Command("upcoming", ""), [], now=_now())
    assert result.reply == "No upcoming events in the next 7 days."


def test_handle_command_low() -> None:
    """/low lists low-priority events on demand."""
    event = _event(priority=EventPriority.LOW, start_at=_now() + timedelta(days=1))
    result = handle_command(Command("low", ""), [event], now=_now())
    assert "💤 Low priority" in result.reply
    assert "Team standup" in result.reply


def test_handle_command_low_empty() -> None:
    """/low with no low-priority events says so."""
    result = handle_command(Command("low", ""), [], now=_now())
    assert result.reply == "No low-priority events."


def test_handle_command_add_parse_marker() -> None:
    """/add returns the text with an add_parse marker for the adapter to parse."""
    result = handle_command(Command("add", "dentist tomorrow 9am"), [], now=_now())
    assert result.message_type == "add_parse"
    assert result.reply == "dentist tomorrow 9am"


def test_handle_command_add_missing_text() -> None:
    """/add with no text returns a usage hint."""
    result = handle_command(Command("add", ""), [], now=_now())
    assert "Usage: /add <event text>" in result.reply


def test_handle_command_unknown() -> None:
    """An unknown command returns a usage hint."""
    result = handle_command(Command("bogus", ""), [], now=_now())
    assert "Unknown command" in result.reply
    assert "/today" in result.reply


# --- draft flow (pure) --------------------------------------------------------


def _draft(**overrides: object) -> ParsedDraft:
    """Build a minimal parsed draft."""
    values: dict[str, object] = {
        "title": "Dentist",
        "start_at": "2026-01-02T09:00:00+00:00",
        "priority": "medium",
        "type": "one_time",
        "tz": "UTC",
        "channels": ["telegram"],
    }
    values.update(overrides)
    return ParsedDraft(**values)


def test_format_draft_card() -> None:
    """A draft card renders the title and the confident fields."""
    card = format_draft_card(_draft())
    assert "📝 Dentist" in card
    # The When line shows the wall clock in the draft zone with a zone label
    # (never a bare ISO that reads as local time).
    assert "Jan 02 09:00 (UTC)" in card
    assert "2026-01-02T09:00:00+00:00" not in card
    assert "Priority: medium" in card
    assert "Channels: telegram" in card


def test_format_draft_when_converts_to_draft_tz() -> None:
    """A UTC-stamped draft for an EDT owner renders as local time (the #131 class).

    Regression test for the reported voice message: submitted ~14:50 EDT,
    "in half an hour" resolved to 19:19 UTC — correct instant, but the card
    showed the bare 19:19 ISO. It must read 15:19 in the draft zone.
    """
    when = format_draft_when(
        _draft(start_at="2026-09-22T19:19:43+00:00", tz="America/New_York")
    )
    assert when is not None
    assert "15:19" in when
    assert "America/New_York" in when
    assert "19:19" not in when


def test_format_draft_when_naive_is_wall_clock_in_draft_zone() -> None:
    """A naive start_at is the wall clock in the draft zone (web-UI convention)."""
    when = format_draft_when(_draft(start_at="2026-01-02T09:00:00", tz="UTC"))
    assert when is not None
    assert "Jan 02 09:00 (UTC)" in when


def test_format_draft_when_falls_back_to_raw() -> None:
    """Unparseable times / unknown zones never break the card (raw fallback)."""
    assert format_draft_when(_draft(start_at="not-a-time", tz="UTC")) == "not-a-time"
    raw = "2026-01-02T09:00:00+00:00"
    assert format_draft_when(_draft(start_at=raw, tz="Not/AZone")) == raw
    assert format_draft_when(_draft(start_at=None)) is None


def test_format_draft_card_omits_when_without_start() -> None:
    """A draft without a start time has no When line."""
    card = format_draft_card(_draft(start_at=None))
    assert "When:" not in card


def test_format_draft_card_omits_unknown_fields() -> None:
    """Optional fields the model didn't fill are omitted from the card."""
    card = format_draft_card(_draft(rrule=None, tags=None, all_day=None, channels=None))
    assert "Repeats:" not in card
    assert "Tags:" not in card
    assert "All day:" not in card
    assert "Channels:" not in card


def test_format_draft_card_extra_fields() -> None:
    """All-day, recurrence and tags are rendered when present."""
    card = format_draft_card(
        _draft(all_day=True, rrule="FREQ=DAILY", tags=["health", "morning"])
    )
    assert "All day: yes" in card
    assert "Repeats: FREQ=DAILY" in card
    assert "Tags: health, morning" in card


def test_build_draft_keyboard() -> None:
    """The draft keyboard has Save/Edit/Discard with indexed callback data."""
    buttons = build_draft_keyboard(2)
    assert buttons == [
        ("💾 Save", "draft:save:2"),
        ("✏️ Edit", "draft:edit:2"),
        ("🗑 Discard", "draft:discard:2"),
    ]


def test_parse_draft_callback() -> None:
    """A well-formed draft callback parses into a DraftAction."""
    assert parse_draft_callback("draft:save:0") == DraftAction("save", 0)
    assert parse_draft_callback("draft:edit:1") == DraftAction("edit", 1)
    assert parse_draft_callback("draft:discard:3") == DraftAction("discard", 3)


def test_parse_draft_callback_invalid() -> None:
    """Malformed / unknown callback payloads are rejected."""
    assert parse_draft_callback(None) is None
    assert parse_draft_callback("") is None
    assert parse_draft_callback("other:save:0") is None
    assert parse_draft_callback("draft:bogus:0") is None
    assert parse_draft_callback("draft:save") is None
    assert parse_draft_callback("draft:save:abc") is None
    assert parse_draft_callback("draft:save:-1") is None


def test_draft_to_event_create_maps_fields() -> None:
    """A confirmed draft maps onto an active telegram_text EventCreate."""
    payload = draft_to_event_create(_draft(), "dentist tomorrow 9am")
    assert payload.title == "Dentist"
    assert payload.start_at.isoformat() == "2026-01-02T09:00:00+00:00"
    assert payload.type == EventType.ONE_TIME
    assert payload.priority == EventPriority.MEDIUM
    assert payload.channels == [EventChannel.TELEGRAM]
    assert payload.source == EventSource.TELEGRAM_TEXT
    assert payload.status == EventStatus.ACTIVE
    assert payload.raw_input == "dentist tomorrow 9am"


def test_draft_to_event_create_defaults() -> None:
    """Missing optional draft fields fall back to safe defaults."""
    payload = draft_to_event_create(
        _draft(priority=None, type=None, channels=None), "x"
    )
    assert payload.priority == EventPriority.MEDIUM
    assert payload.type == EventType.ONE_TIME
    assert payload.channels == [EventChannel.TELEGRAM]
    assert payload.tz == "UTC"


def test_draft_store_roundtrip() -> None:
    """DraftStore holds, replaces and pops a chat's pending draft."""
    store = DraftStore()
    pending = PendingDraft(drafts=[_draft()], raw_input="x")
    assert store.get(123) is None
    store.set(123, pending)
    assert store.get(123) is pending
    # A new /add replaces the pending draft for the same chat.
    replacement = PendingDraft(drafts=[_draft(title="New")], raw_input="y")
    store.set(123, replacement)
    assert store.get(123) is replacement
    assert store.pop(123) is replacement
    assert store.get(123) is None


# --- inbound record -----------------------------------------------------------


def test_build_inbound_record_maps_fields() -> None:
    """A message-like object maps onto a TelegramInbound row."""

    class FakeChat:
        id = 123
        type = "private"

    class FakeUser:
        id = 42

    class FakeMessage:
        message_id = 7
        chat = FakeChat()
        from_user = FakeUser()
        text = "/today"

    record = build_inbound_record(FakeMessage(), "text")
    assert record.telegram_message_id == "7"
    assert record.chat_id == "123"
    assert record.text == "/today"
    assert record.message_type == "text"


def test_record_inbound_persists(session_factory: sessionmaker[Session]) -> None:
    """record_inbound persists a TelegramInbound row."""

    class FakeChat:
        id = 123
        type = "private"

    class FakeMessage:
        message_id = 7
        chat = FakeChat()
        from_user = type("U", (), {"id": 42})()
        text = "/today"

    with session_factory() as session:
        record = record_inbound(session, FakeMessage(), "text")
        assert record.id is not None
    with session_factory() as session:
        assert session.query(TelegramInbound).count() == 1


# --- impure wiring (thin) -----------------------------------------------------


class _FakeChat:
    def __init__(self, chat_id: int, chat_type: str) -> None:
        self.id = chat_id
        self.type = chat_type


class _FakeUser:
    def __init__(self, user_id: int) -> None:
        self.id = user_id


class _FakeMessage:
    def __init__(
        self, chat: _FakeChat, user: _FakeUser, text: str, message_id: int = 1
    ) -> None:
        self.chat = chat
        self.from_user = user
        self.text = text
        self.message_id = message_id


class _FakeUpdate:
    def __init__(self, message: _FakeMessage | None) -> None:
        self.effective_message = message
        self.message = message


def test_handle_update_dm_only() -> None:
    """A group message is ignored even from the allowed user."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(_FakeMessage(_FakeChat(123, "group"), _FakeUser(42), "/today"))
    assert _handle_update(update, settings) is None


def test_handle_update_allowlist_rejection() -> None:
    """A private message from a non-allowed user is ignored."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(999), "/today")
    )
    assert _handle_update(update, settings) is None


def test_handle_update_allowlist_multi_id_allows_second_user(
    session_factory: sessionmaker[Session],
) -> None:
    """A DM from any allowlisted id (TELEGRAM_USER_IDS) is processed (issue #112)."""
    with session_factory() as session:
        session.add(_event(start_at=_now() + timedelta(hours=1)))
        session.commit()

    settings = Settings(telegram_user_ids="42,222", telegram_bot_token="123:abc")
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(222), "/today")
    )
    reply = _handle_update(update, settings, session_factory, now=_now())
    assert reply is not None
    assert "📅 Today" in reply.text


def test_handle_update_allowlist_denial_logs_one_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A non-allowlisted user's message is ignored with exactly one warning."""
    settings = Settings(telegram_user_ids="42,222", telegram_bot_token="123:abc")
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(999), "/today")
    )
    with caplog.at_level(logging.WARNING):
        assert _handle_update(update, settings) is None
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    # The sender id is logged for diagnostics; the message content never is.
    assert "999" in warnings[0].getMessage()
    assert "/today" not in warnings[0].getMessage()


def test_handle_update_empty_allowlist_denies_everyone() -> None:
    """With no allowlist configured every message is ignored (fail closed)."""
    settings = Settings(
        telegram_user_id=None, telegram_user_ids=None, telegram_bot_token="123:abc"
    )
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "/today")
    )
    assert _handle_update(update, settings) is None


def test_handle_update_no_message() -> None:
    """An update with no message is ignored."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    assert _handle_update(_FakeUpdate(None), settings) is None


def test_handle_update_plain_text_routes_to_add_flow(
    session_factory: sessionmaker[Session],
) -> None:
    """Plain text (not a command) is parsed as an implicit /add (not ignored)."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    update = _FakeUpdate(
        _FakeMessage(
            _FakeChat(123, "private"),
            _FakeUser(42),
            "Hanging on the bar for 2 minutes each day",
        )
    )
    reply = _handle_update(
        update,
        settings,
        session_factory,
        now=_now(),
        draft_store=store,
    )
    assert reply is not None
    assert "📝 Hanging on the bar for each day" in reply.text
    pending = store.get(123)
    assert pending is not None
    assert pending.raw_input == "Hanging on the bar for 2 minutes each day"
    with session_factory() as session:
        assert session.query(TelegramInbound).one().message_type == "draft"


def test_handle_update_empty_text_ignored(caplog: pytest.LogCaptureFixture) -> None:
    """Whitespace-only text is ignored (but logged, not silent)."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(_FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "   "))
    with caplog.at_level(logging.INFO):
        assert _handle_update(update, settings) is None
    assert any("empty text" in r.getMessage() for r in caplog.records)


def test_handle_update_group_message_logged(caplog: pytest.LogCaptureFixture) -> None:
    """A group message is ignored with a log line (analyzable, not silent)."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(_FakeMessage(_FakeChat(123, "group"), _FakeUser(42), "/today"))
    with caplog.at_level(logging.INFO):
        assert _handle_update(update, settings) is None
    assert any("non-private" in r.getMessage() for r in caplog.records)


def test_saved_confirmation_reply() -> None:
    """The save confirmation names the event title (pure)."""
    from app.telegram_inbound import saved_confirmation_reply

    assert saved_confirmation_reply("Dentist") == "✅ Saved: Dentist"


def test_handle_update_today_replies_and_records(
    session_factory: sessionmaker[Session],
) -> None:
    """A private /today from the allowed user replies and records inbound."""
    with session_factory() as session:
        session.add(_event(start_at=_now() + timedelta(hours=1)))
        session.commit()

    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "/today")
    )
    reply = _handle_update(update, settings, session_factory, now=_now())
    assert reply is not None
    assert "📅 Today" in reply.text
    assert "Team standup" in reply.text

    with session_factory() as session:
        assert session.query(TelegramInbound).count() == 1
        assert session.query(TelegramInbound).one().text == "/today"


def test_build_telegram_inbound_application() -> None:
    """No token -> None (no-op, never polls); with token -> an Application."""
    assert (
        build_telegram_inbound_application(
            Settings(telegram_bot_token=None, telegram_user_id="1")
        )
        is None
    )
    app = build_telegram_inbound_application(
        Settings(telegram_bot_token="123:abc", telegram_user_id="1")
    )
    assert app is not None
    assert app.bot.token == "123:abc"


def test_build_telegram_inbound_application_replies(
    session_factory: sessionmaker[Session],
) -> None:
    """The handler replies to a private command via ``reply_text``."""
    import asyncio

    with session_factory() as session:
        session.add(_event(start_at=_now() + timedelta(hours=1)))
        session.commit()

    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    app = build_telegram_inbound_application(settings, session_factory, now=_now())
    assert app is not None

    # Grab the nested handler off the MessageHandler it is registered on.
    handler = app.handlers[0][0].callback

    replied: list[str] = []

    class _ReplyMessage(_FakeMessage):
        async def reply_text(self, text: str) -> None:
            replied.append(text)

    update = _FakeUpdate(
        _ReplyMessage(_FakeChat(123, "private"), _FakeUser(42), "/today")
    )
    asyncio.run(handler(update, None))

    assert len(replied) == 1
    assert "📅 Today" in replied[0]
    assert "Team standup" in replied[0]


def test_build_telegram_inbound_application_no_reply_for_ignored(
    session_factory: sessionmaker[Session],
) -> None:
    """The handler sends nothing for a message the DM gate ignores."""
    import asyncio

    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    app = build_telegram_inbound_application(settings, session_factory, now=_now())
    assert app is not None
    handler = app.handlers[0][0].callback

    replied: list[str] = []

    class _ReplyMessage(_FakeMessage):
        async def reply_text(self, text: str) -> None:
            replied.append(text)

    # Group message from the allowed user is ignored -> no reply.
    update = _FakeUpdate(
        _ReplyMessage(_FakeChat(123, "group"), _FakeUser(42), "/today")
    )
    asyncio.run(handler(update, None))
    assert replied == []


# --- draft flow (impure wiring) ------------------------------------------------


class _FakeCallback:
    def __init__(self, data: str, user_id: int, chat_id: int) -> None:
        self.data = data
        self.from_user = _FakeUser(user_id)
        self.message = _FakeMessage(
            _FakeChat(chat_id, "private"), _FakeUser(user_id), "/add x"
        )


def test_handle_callback_query_no_message() -> None:
    """A callback with no message/chat replies there is nothing to act on."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    query = _FakeCallback("draft:save:0", 42, 123)
    query.message = None
    reply = _handle_callback_query(query, settings, None, store, now=_now())
    assert reply is not None
    assert "No pending draft" in reply.text


def test_handle_callback_query_save_no_db() -> None:
    """Save without a database replies that it can't save right now."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    store.set(123, PendingDraft(drafts=[_draft()], raw_input="x"))
    query = _FakeCallback("draft:save:0", 42, 123)
    reply = _handle_callback_query(query, settings, None, store, now=_now())
    assert reply is not None
    assert "Can't save right now" in reply.text
    # The pending draft is retained (not saved).
    assert store.get(123) is not None


def test_build_telegram_inbound_application_draft_card(
    session_factory: sessionmaker[Session],
) -> None:
    """The handler sends a draft card with an inline keyboard for /add."""
    import asyncio

    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    store = DraftStore()
    app = build_telegram_inbound_application(
        settings, session_factory, now=_now(), draft_store=store
    )
    assert app is not None
    handler = app.handlers[0][0].callback

    sent: list[tuple[str, object]] = []

    class _ReplyMessage(_FakeMessage):
        async def reply_text(self, text: str, **kwargs: object) -> None:
            sent.append((text, kwargs))

    update = _FakeUpdate(
        _ReplyMessage(
            _FakeChat(123, "private"), _FakeUser(42), "/add dentist tomorrow at 9am"
        )
    )
    asyncio.run(handler(update, None))

    # One message: the draft card with an inline keyboard (no pending ack —
    # the deterministic parse is instant).
    assert len(sent) == 1
    text, kwargs = sent[0]
    assert "📝 dentist" in text
    assert "reply_markup" in kwargs


def test_build_telegram_inbound_application_callback_save(
    session_factory: sessionmaker[Session],
) -> None:
    """The callback handler routes a Save button to persist the event."""
    import asyncio

    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    store = DraftStore()
    store.set(123, PendingDraft(drafts=[_draft()], raw_input="x"))
    app = build_telegram_inbound_application(
        settings, session_factory, now=_now(), draft_store=store
    )
    assert app is not None
    callback = app.handlers[0][2].callback  # [0]=text, [1]=voice, [2]=callback

    answered: list[str] = []
    sent: list[str] = []

    class _FakeQuery:
        data = "draft:save:0"
        from_user = _FakeUser(42)
        message = _FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "/add x")

        async def answer(self) -> None:
            answered.append("ok")

    class _ReplyMessage(_FakeMessage):
        async def reply_text(self, text: str, **kwargs: object) -> None:
            sent.append(text)

    query = _FakeQuery()
    query.message = _ReplyMessage(_FakeChat(123, "private"), _FakeUser(42), "/add x")

    class _Update:
        callback_query = query

    asyncio.run(callback(_Update(), None))

    assert answered == ["ok"]
    assert sent == ["✅ Saved: Dentist"]
    with session_factory() as session:
        assert session.query(Event).one().title == "Dentist"


def test_build_telegram_inbound_application_callback_guards() -> None:
    """The callback handler ignores updates with no query or no action."""
    import asyncio

    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    app = build_telegram_inbound_application(settings, None, now=_now())
    assert app is not None
    callback = app.handlers[0][2].callback  # [0]=text, [1]=voice, [2]=callback

    class _NoQueryUpdate:
        callback_query = None

    # No callback_query -> no-op.
    asyncio.run(callback(_NoQueryUpdate(), None))

    sent: list[str] = []

    class _FakeQuery:
        data = "bogus:data"
        from_user = _FakeUser(42)

        async def answer(self) -> None:
            pass

    class _ReplyMessage(_FakeMessage):
        async def reply_text(self, text: str, **kwargs: object) -> None:
            sent.append(text)

    class _Update:
        callback_query = _FakeQuery()

    _Update.callback_query.message = _ReplyMessage(
        _FakeChat(123, "private"), _FakeUser(42), "/add x"
    )
    # A malformed payload -> _handle_callback_query returns None -> no reply.
    asyncio.run(callback(_Update(), None))
    assert sent == []


def test_handle_callback_query_save_persists_event(
    session_factory: sessionmaker[Session],
) -> None:
    """Save persists the confirmed draft as a real event and clears it."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    store.set(123, PendingDraft(drafts=[_draft()], raw_input="dentist tomorrow 9am"))
    query = _FakeCallback("draft:save:0", 42, 123)
    reply = _handle_callback_query(query, settings, session_factory, store, now=_now())
    assert reply is not None
    assert "✅ Saved: Dentist" in reply.text
    assert store.get(123) is None
    with session_factory() as session:
        event = session.query(Event).one()
        assert event.title == "Dentist"
        assert event.status == EventStatus.ACTIVE
        assert event.source == EventSource.TELEGRAM_TEXT
        assert event.raw_input == "dentist tomorrow 9am"


def test_handle_callback_query_edit_prompts() -> None:
    """Edit re-prompts for corrected text and keeps the pending draft."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    store.set(123, PendingDraft(drafts=[_draft()], raw_input="x"))
    query = _FakeCallback("draft:edit:0", 42, 123)
    reply = _handle_callback_query(query, settings, None, store, now=_now())
    assert reply is not None
    assert "Send the corrected event text" in reply.text
    assert store.get(123) is not None


def test_handle_callback_query_discard_drops() -> None:
    """Discard drops the pending draft with a confirmation reply."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    store.set(123, PendingDraft(drafts=[_draft()], raw_input="x"))
    query = _FakeCallback("draft:discard:0", 42, 123)
    reply = _handle_callback_query(query, settings, None, store, now=_now())
    assert reply is not None
    assert "Draft discarded" in reply.text
    assert store.get(123) is None


def test_handle_callback_query_allowlist_rejection() -> None:
    """A callback from a non-allowed user is ignored."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    store.set(123, PendingDraft(drafts=[_draft()], raw_input="x"))
    query = _FakeCallback("draft:save:0", 999, 123)
    assert _handle_callback_query(query, settings, None, store, now=_now()) is None


def test_handle_callback_query_allows_any_allowlisted_user() -> None:
    """A callback from a second allowlisted id acts on the draft (issue #112)."""
    settings = Settings(telegram_user_ids="42,222", telegram_bot_token="123:abc")
    store = DraftStore()
    store.set(123, PendingDraft(drafts=[_draft()], raw_input="x"))
    query = _FakeCallback("draft:discard:0", 222, 123)
    reply = _handle_callback_query(query, settings, None, store, now=_now())
    assert reply is not None
    assert "Draft discarded" in reply.text
    assert store.get(123) is None


def test_handle_callback_query_no_pending_draft() -> None:
    """A callback with no pending draft replies that it's gone."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    query = _FakeCallback("draft:save:0", 42, 123)
    reply = _handle_callback_query(query, settings, None, store, now=_now())
    assert reply is not None
    assert "That draft is no longer available" in reply.text


def test_handle_callback_query_out_of_range_index() -> None:
    """A callback index >= len(drafts) replies the draft is gone.

    Exercises the ``action.index >= len(pending.drafts)`` guard directly (not
    via the ``pending is None`` short-circuit): a chat has a pending draft with
    a single draft, but the callback asks for index 5.
    """
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    store.set(123, PendingDraft(drafts=[_draft()], raw_input="x"))
    query = _FakeCallback("draft:save:5", 42, 123)
    reply = _handle_callback_query(query, settings, None, store, now=_now())
    assert reply is not None
    assert "That draft is no longer available" in reply.text


def test_handle_callback_query_bad_payload() -> None:
    """A malformed callback payload is ignored."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    store.set(123, PendingDraft(drafts=[_draft()], raw_input="x"))
    query = _FakeCallback("bogus:data", 42, 123)
    assert _handle_callback_query(query, settings, None, store, now=_now()) is None


# --- voice messages (not supported) ----------------------------------------------


def test_voice_not_supported_reply_is_static() -> None:
    """Voice input gets a static reply pointing at the text path."""
    assert (
        voice_not_supported()
        == "Voice messages aren't supported — send text or use /add"
    )


def test_build_telegram_inbound_application_voice_handler_replies_statically(
    session_factory: sessionmaker[Session],
) -> None:
    """The registered VOICE handler sends the static not-supported reply."""
    import asyncio

    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    app = build_telegram_inbound_application(settings, session_factory, now=_now())
    assert app is not None
    voice_handler = app.handlers[0][1].callback  # [0]=text, [1]=voice, [2]=callback

    replied: list[str] = []

    class _ReplyVoiceMessage(_FakeMessage):
        async def reply_text(self, text: str, **kwargs: object) -> None:
            replied.append(text)

    update = _FakeUpdate(
        _ReplyVoiceMessage(_FakeChat(123, "private"), _FakeUser(42), None)
    )
    asyncio.run(voice_handler(update, None))

    assert replied == ["Voice messages aren't supported — send text or use /add"]


def test_build_telegram_inbound_application_voice_handler_ignores_groups() -> None:
    """Group voice messages and non-allowlisted users get no reply."""
    import asyncio

    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    app = build_telegram_inbound_application(settings, None, now=_now())
    assert app is not None
    voice_handler = app.handlers[0][1].callback

    replied: list[str] = []

    class _ReplyVoiceMessage(_FakeMessage):
        async def reply_text(self, text: str, **kwargs: object) -> None:
            replied.append(text)

    group = _FakeUpdate(
        _ReplyVoiceMessage(_FakeChat(123, "group"), _FakeUser(42), None)
    )
    stranger = _FakeUpdate(
        _ReplyVoiceMessage(_FakeChat(123, "private"), _FakeUser(999), None)
    )
    asyncio.run(voice_handler(group, None))
    asyncio.run(voice_handler(stranger, None))
    assert replied == []


# --- scheduler threading on save (issue #134, M10-T1) --------------------------


def test_save_draft_passes_scheduler_to_crud(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Saving a draft threads the scheduler + job func into crud (#134)."""
    from app import crud as crud_module
    from app.scheduler import build_scheduler

    captured: dict[str, object] = {}
    real_create = crud_module.create_event

    def _spy(
        session: Session,
        payload: object,
        *,
        scheduler: object = None,
        job_func: object = None,
    ) -> object:
        captured.update(scheduler=scheduler, job_func=job_func)
        return real_create(session, payload)

    monkeypatch.setattr(crud_module, "create_event", _spy)

    def _noop_job(*args: object, **kwargs: object) -> object:
        return None

    scheduler = build_scheduler(
        Settings(data_dir=Path("/tmp"), db_name=f"inbound-{id(object())}.db")
    )
    try:
        store = DraftStore()
        pending = PendingDraft(drafts=[_draft()], raw_input="dentist tomorrow 9am")
        store.set(123, pending)
        reply = _save_draft(
            session_factory,
            _draft(),
            pending,
            123,
            store,
            scheduler=scheduler,
            job_func=_noop_job,
        )
        assert "✅ Saved: Dentist" in reply.text
        assert captured["scheduler"] is scheduler
        assert captured["job_func"] is _noop_job
    finally:
        with contextlib.suppress(Exception):
            scheduler.shutdown(wait=False)


def test_save_draft_schedules_nothing_without_offsets(
    session_factory: sessionmaker[Session],
) -> None:
    """A saved event without reminder offsets schedules no jobs.

    Saved Telegram events are active (visible in calendar/agenda/summary), but
    with no offsets the plan is empty — jobs appear once offsets exist (the
    CRUD create/update path handles it, issue #134).
    """
    from app.scheduler import build_scheduler, event_job_keys

    scheduler = build_scheduler(
        Settings(data_dir=Path("/tmp"), db_name=f"draft-{id(object())}.db")
    )
    try:
        store = DraftStore()
        pending = PendingDraft(drafts=[_draft()], raw_input="dentist tomorrow 9am")
        store.set(123, pending)
        reply = _save_draft(
            session_factory,
            _draft(),
            pending,
            123,
            store,
            scheduler=scheduler,
            job_func=lambda *a, **k: None,
        )
        assert "✅ Saved: Dentist" in reply.text
        with session_factory() as session:
            event = session.query(Event).one()
        # No offsets on this draft, so the (active) event schedules nothing.
        assert event.status == EventStatus.ACTIVE
        assert event_job_keys(scheduler, event.id) == {}
    finally:
        with contextlib.suppress(Exception):
            scheduler.shutdown(wait=False)


def test_build_telegram_inbound_application_scheduler_default_job_func(
    tmp_path: Path,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A scheduler without an explicit ``job_func`` defaults to the picklable
    ``telegram_reminder_job`` entrypoint (issue #134/#137).

    ``build_telegram_inbound_application(scheduler=<scheduler>)`` without
    ``job_func`` must fill in the module-level picklable entrypoint so saved
    drafts schedule jobs that survive restarts; a full build + save-callback
    round-trip proves the default reaches crud (no Telegram/network involved).
    """
    import asyncio

    from app import crud as crud_module
    from app.scheduler import build_scheduler
    from app.telegram_outbound import telegram_reminder_job

    captured: dict[str, object] = {}
    real_create = crud_module.create_event

    def _spy(
        session: Session,
        payload: object,
        *,
        scheduler: object = None,
        job_func: object = None,
    ) -> object:
        captured.update(scheduler=scheduler, job_func=job_func)
        return real_create(session, payload)

    monkeypatch.setattr(crud_module, "create_event", _spy)

    scheduler = build_scheduler(Settings(data_dir=tmp_path))
    try:
        settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
        store = DraftStore()
        store.set(123, PendingDraft(drafts=[_draft()], raw_input="x"))
        # scheduler=<scheduler> and no job_func -> the build supplies the
        # picklable default entrypoint itself.
        app = build_telegram_inbound_application(
            settings,
            session_factory,
            now=_now(),
            draft_store=store,
            scheduler=scheduler,
        )
        assert app is not None
        callback = app.handlers[0][2].callback  # [0]=text, [1]=voice, [2]=callback

        class _FakeQuery:
            data = "draft:save:0"
            from_user = _FakeUser(42)

            async def answer(self) -> None:
                pass

        class _ReplyMessage(_FakeMessage):
            async def reply_text(self, text: str, **kwargs: object) -> None:
                pass

        query = _FakeQuery()
        query.message = _ReplyMessage(
            _FakeChat(123, "private"), _FakeUser(42), "/add x"
        )

        class _Update:
            callback_query = query

        asyncio.run(callback(_Update(), None))

        assert captured["scheduler"] is scheduler
        assert captured["job_func"] is telegram_reminder_job
    finally:
        with contextlib.suppress(Exception):
            scheduler.shutdown(wait=False)


def test_draft_reminder_offsets_prefers_model_value() -> None:
    """Model offsets (normalized) win over the raw-text fallback."""
    from app.telegram_inbound import draft_reminder_offsets

    assert draft_reminder_offsets(_draft(reminder_offsets=["1 hour"]), "x") == ["1h"]
    assert draft_reminder_offsets(
        _draft(reminder_offsets=["15m"]),
        "notify me 1 hour in advance",
    ) == ["15m"]


def test_draft_reminder_offsets_falls_back_to_text() -> None:
    """Without model offsets, an explicit phrase still yields a reminder."""
    from app.telegram_inbound import draft_reminder_offsets

    assert draft_reminder_offsets(
        _draft(),
        "I have an interview in half an hour, notify me via telegram "
        "channel 15 minutes in advance",
    ) == ["15m"]
    assert draft_reminder_offsets(_draft(), "dentist tomorrow 9am") == []


def test_draft_to_event_create_maps_reminders_and_tz() -> None:
    """Save persists reminder offsets and the caller's default tz."""
    payload = draft_to_event_create(
        _draft(),
        "interview, notify me 15 minutes in advance",
        default_tz="America/New_York",
    )
    assert payload.reminder_offsets == ["15m"]
    # The draft fixture carries tz=UTC, which wins over the default.
    assert payload.tz == "UTC"
    payload = draft_to_event_create(
        _draft(tz=None),
        "dentist tomorrow 9am",
        default_tz="America/New_York",
    )
    assert payload.tz == "America/New_York"
    assert payload.reminder_offsets == []


def test_format_draft_card_shows_reminders() -> None:
    """The draft card surfaces the reminder so the owner can verify it."""
    card = format_draft_card(_draft(reminder_offsets=["15m"]))
    assert "15m" in card


# --- deterministic quick flow (/add smart + /quick, no LLM) ---------------------


def test_handle_command_quick_parse_marker() -> None:
    """/quick returns the text with a quick_parse marker for the adapter."""
    result = handle_command(Command("quick", "Buy milk"), [], now=_now())
    assert result.message_type == "quick_parse"
    assert result.reply == "Buy milk"


def test_handle_command_quick_missing_text() -> None:
    """/quick with no text returns a usage hint."""
    result = handle_command(Command("quick", ""), [], now=_now())
    assert result.message_type == "text"
    assert "Usage: /quick <event text>" in result.reply


def test_handle_command_unknown_mentions_quick() -> None:
    """The unknown-command hint points at /quick too."""
    result = handle_command(Command("bogus", ""), [], now=_now())
    assert "/quick" in result.reply


def test_handle_update_add_with_date_resolves_offline(
    session_factory: sessionmaker[Session],
) -> None:
    """/add with an explicit date parses offline (no network, no key)."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    update = _FakeUpdate(
        _FakeMessage(
            _FakeChat(123, "private"),
            _FakeUser(42),
            "/add Pick up daughter from school on Friday at 18:00 1h",
        )
    )
    reply = _handle_update(
        update,
        settings,
        session_factory,
        now=datetime(2026, 9, 22, 9, 0, tzinfo=UTC),
        draft_store=store,
    )
    assert reply is not None
    assert "📝 Pick up daughter from school" in reply.text
    assert "Fri, Sep 25 18:00" in reply.text
    assert "1h before" in reply.text
    assert reply.reply_markup == [
        [
            ("💾 Save", "draft:save:0"),
            ("✏️ Edit", "draft:edit:0"),
            ("🗑 Discard", "draft:discard:0"),
        ]
    ]
    pending = store.get(123)
    assert pending is not None
    assert pending.raw_input == "Pick up daughter from school on Friday at 18:00 1h"
    with session_factory() as session:
        assert session.query(TelegramInbound).one().message_type == "draft"


def test_handle_update_quick_always_offline() -> None:
    """/quick parses even a dateless line (today default)."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "/quick Buy milk")
    )
    reply = _handle_update(
        update,
        settings,
        None,
        now=datetime(2026, 9, 22, 9, 0, tzinfo=UTC),
        draft_store=store,
    )
    assert reply is not None
    assert "📝 Buy milk" in reply.text
    assert "Sep 22" in reply.text
    assert "1d before" in reply.text
    assert reply.reply_markup is not None
    assert store.get(123) is not None


def test_handle_update_add_vague_parses_offline_today() -> None:
    """Vague /add text (no date/time) yields an instant today/all-day draft."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    update = _FakeUpdate(
        _FakeMessage(
            _FakeChat(123, "private"), _FakeUser(42), "/add dentist birthday surprise"
        )
    )
    reply = _handle_update(update, settings, None, now=_now(), draft_store=store)
    assert reply is not None
    assert "📝 dentist birthday surprise" in reply.text
    assert "All day: yes" in reply.text
    assert store.get(123) is not None


def test_quick_draft_save_persists_event(
    session_factory: sessionmaker[Session],
) -> None:
    """Full offline loop: /quick draft card → Save → persisted active event."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    store = DraftStore()
    update = _FakeUpdate(
        _FakeMessage(
            _FakeChat(123, "private"),
            _FakeUser(42),
            "/quick Silo season on June 12 2027",
        )
    )
    reply = _handle_update(
        update,
        settings,
        session_factory,
        now=datetime(2026, 9, 22, 9, 0, tzinfo=UTC),
        draft_store=store,
    )
    assert reply is not None
    assert "📝 Silo season" in reply.text

    query = _FakeCallback("draft:save:0", 42, 123)
    saved = _handle_callback_query(query, settings, session_factory, store)
    assert saved is not None
    assert "✅ Saved: Silo season" in saved.text
    assert store.get(123) is None
    with session_factory() as session:
        event = session.query(Event).one()
        assert event.title == "Silo season"
        assert event.status == EventStatus.ACTIVE
        assert event.source == EventSource.TELEGRAM_TEXT
        assert event.reminder_offsets == ["1d"]


# --- reply retry (2026-10-12 /add outage: transient ConnectError) --------------


def test_send_reply_with_retry_succeeds_first_try() -> None:
    """A healthy send returns True after a single attempt."""
    import asyncio

    sent: list[str] = []

    async def _ok(text: str, **kwargs: object) -> None:
        sent.append(text)

    ok = asyncio.run(_send_reply_with_retry(_ok, BotReply("hi")))
    assert ok is True
    assert sent == ["hi"]


def test_send_reply_with_retry_retries_transient_failure() -> None:
    """One transient failure is retried and the reply still goes out."""
    import asyncio

    calls: list[int] = []

    async def _flaky(text: str, **kwargs: object) -> None:
        calls.append(1)
        if len(calls) == 1:
            raise ConnectionError("tls blip")
        return None

    ok = asyncio.run(_send_reply_with_retry(_flaky, BotReply("card")))
    assert ok is True
    assert len(calls) == 2


def test_send_reply_with_retry_gives_up_loudly() -> None:
    """Persistent failure returns False (no raise) after max attempts."""
    import asyncio

    calls: list[int] = []

    async def _dead(text: str, **kwargs: object) -> None:
        calls.append(1)
        raise ConnectionError("down")

    ok = asyncio.run(_send_reply_with_retry(_dead, BotReply("card")))
    assert ok is False
    from app import telegram_inbound as _inbound

    assert len(calls) == _inbound._REPLY_MAX_ATTEMPTS


def test_send_text_with_retry_retries_then_succeeds() -> None:
    """The voice-path text sender also retries a transient failure."""
    import asyncio

    calls: list[int] = []

    async def _flaky(text: str) -> None:
        calls.append(1)
        if len(calls) == 1:
            raise TimeoutError("blip")

    ok = asyncio.run(_send_text_with_retry(_flaky, "hello"))
    assert ok is True
    assert len(calls) == 2


def test_build_application_registers_error_handler() -> None:
    """The application has an error handler so failures are never silent."""
    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    app = build_telegram_inbound_application(settings, None, now=_now())
    assert app is not None
    assert app.error_handlers  # type: ignore[attr-defined]


def test_text_handler_survives_transient_send_failure(
    session_factory: sessionmaker[Session],
) -> None:
    """The /today handler retries the send instead of raising (no silent drop)."""
    import asyncio

    with session_factory() as session:
        session.add(_event(start_at=_now() + timedelta(hours=1)))
        session.commit()

    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    app = build_telegram_inbound_application(settings, session_factory, now=_now())
    assert app is not None
    handler = app.handlers[0][0].callback

    calls: list[int] = []
    replied: list[str] = []

    class _FlakyMessage(_FakeMessage):
        async def reply_text(self, text: str, **kwargs: object) -> None:
            calls.append(1)
            if len(calls) == 1:
                raise ConnectionError("tls blip")
            replied.append(text)

    update = _FakeUpdate(
        _FlakyMessage(_FakeChat(123, "private"), _FakeUser(42), "/today")
    )
    asyncio.run(handler(update, None))  # must not raise

    assert len(calls) == 2
    assert len(replied) == 1
    assert "📅 Today" in replied[0]


# --- reminder-card callbacks (ack / snooze / delete) --------------------------


def _add_sent_log(session: Session, event_id: int, occurrence: str = "occ") -> None:
    from app.models import DeliveryLog

    session.add(
        DeliveryLog(
            event_id=event_id,
            occurrence_id=occurrence,
            offset="1h",
            status="sent",
        )
    )


def test_reminder_callback_ack_persists(
    session_factory: sessionmaker[Session],
) -> None:
    """Tapping Ack on a reminder card marks the delivery acked (green card)."""
    from app.models import DeliveryLog
    from app.telegram_outbound import callback_data

    with session_factory() as session:
        session.add(_event())
        session.flush()
        _add_sent_log(session, session.query(Event).one().id)
        session.commit()
        event_id = session.query(Event).one().id

    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    query = _FakeCallback(callback_data("ack", event_id, "occ", "1h"), 42, 123)
    reply = _handle_reminder_callback_query(
        query, settings, session_factory, now=_now()
    )
    assert reply is not None
    assert "Acknowledged" in reply.text
    with session_factory() as session:
        assert session.query(DeliveryLog).one().status == "acked"


def test_reminder_callback_ignores_non_reminder_payload() -> None:
    """Draft payloads fall through (None) so the draft handler runs next."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    assert (
        _handle_reminder_callback_query(
            _FakeCallback("draft:save:0", 42, 123), settings, None, now=_now()
        )
        is None
    )
    assert (
        _handle_reminder_callback_query(
            _FakeCallback("bogus:data", 42, 123), settings, None, now=_now()
        )
        is None
    )


def test_reminder_callback_rejects_non_allowlisted_user(
    session_factory: sessionmaker[Session],
) -> None:
    """Callbacks from other users are ignored (no reply, no state change)."""
    from app.telegram_outbound import callback_data

    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    query = _FakeCallback(callback_data("ack", 1, "occ", "1h"), 999, 123)
    assert (
        _handle_reminder_callback_query(query, settings, session_factory, now=_now())
        is None
    )


def test_reminder_callback_no_db_replies_busy() -> None:
    """A reminder action with no database replies instead of crashing."""
    from app.telegram_outbound import callback_data

    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    query = _FakeCallback(callback_data("ack", 1, "occ", "1h"), 42, 123)
    reply = _handle_reminder_callback_query(query, settings, None, now=_now())
    assert reply is not None
    assert "no database" in reply.text


def test_callback_handler_routes_reminder_ack(
    session_factory: sessionmaker[Session],
) -> None:
    """The polling callback handler answers Ack taps (previously dropped)."""
    import asyncio

    from app.models import DeliveryLog
    from app.telegram_outbound import callback_data

    with session_factory() as session:
        session.add(_event())
        session.flush()
        _add_sent_log(session, session.query(Event).one().id)
        session.commit()
        event_id = session.query(Event).one().id

    settings = Settings(telegram_bot_token="123:abc", telegram_user_id="42")
    app = build_telegram_inbound_application(
        settings, session_factory, now=_now(), draft_store=DraftStore()
    )
    assert app is not None
    callback = app.handlers[0][2].callback  # [0]=text, [1]=voice, [2]=callback

    sent: list[str] = []

    class _ReplyMessage(_FakeMessage):
        async def reply_text(self, text: str, **kwargs: object) -> None:
            sent.append(text)

    class _Query(_FakeCallback):
        async def answer(self) -> None:
            pass

    class _Update:
        callback_query = _Query(callback_data("ack", event_id, "occ", "1h"), 42, 123)
        callback_query.message = _ReplyMessage(
            _FakeChat(123, "private"), _FakeUser(42), "x"
        )

    asyncio.run(callback(_Update(), None))
    assert sent == ["Acknowledged ✓"]
    with session_factory() as session:
        assert session.query(DeliveryLog).one().status == "acked"
