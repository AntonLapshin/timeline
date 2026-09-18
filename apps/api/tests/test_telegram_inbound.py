"""Tests for the Telegram inbound DM command bot (issue #69, M5-T1).

Covers the acceptance criteria:

- **DM-only gate**: ``is_private_chat`` accepts only private chats; groups,
  supergroups and channels are ignored.
- **Allowlist rejection**: ``_handle_update`` ignores messages from users not
  on the allowlist (``TELEGRAM_USER_IDS`` combined with the legacy
  ``TELEGRAM_USER_ID``, issue #112) and from non-private chats.
- **Commands**: ``/today``, ``/upcoming [7d|30d]``, ``/low``, ``/add <text>``
  and ``/ask <question>`` each produce the expected reply; unknown commands get
  a usage hint.
- **No-token no-op**: ``build_telegram_inbound_application`` returns ``None``
  with no bot token (never polls).
"""

from __future__ import annotations

import asyncio
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
from app.llm_parse import ParsedDraft
from app.models import Event, TelegramInbound
from app.stt import SttResult
from app.telegram_inbound import (
    Command,
    DraftAction,
    DraftStore,
    PendingDraft,
    _handle_callback_query,
    _handle_update,
    _handle_voice_update,
    _transcribe_voice_message,
    build_draft_keyboard,
    build_inbound_record,
    build_telegram_inbound_application,
    draft_to_event_create,
    events_low,
    events_today,
    events_upcoming,
    format_draft_card,
    format_event_line,
    handle_command,
    is_private_chat,
    parse_command,
    parse_draft_callback,
    parse_upcoming_days,
    record_inbound,
    voice_error_reply,
    voice_unavailable_reply,
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


def test_handle_command_ask_stub() -> None:
    """/ask records the question and explains the query isn't wired yet."""
    result = handle_command(Command("ask", "when is my next dentist"), [], now=_now())
    assert result.message_type == "text"
    assert "when is my next dentist" in result.reply
    assert "LLM query over history isn't available yet" in result.reply


def test_handle_command_ask_missing_text() -> None:
    """/ask with no question returns a usage hint."""
    result = handle_command(Command("ask", ""), [], now=_now())
    assert "Usage: /ask <question>" in result.reply


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
    assert "2026-01-02T09:00:00+00:00" in card
    assert "Priority: medium" in card
    assert "Channels: telegram" in card


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
    """A confirmed draft maps onto a draft-status telegram_text EventCreate."""
    payload = draft_to_event_create(_draft(), "dentist tomorrow 9am")
    assert payload.title == "Dentist"
    assert payload.start_at.isoformat() == "2026-01-02T09:00:00+00:00"
    assert payload.type == EventType.ONE_TIME
    assert payload.priority == EventPriority.MEDIUM
    assert payload.channels == [EventChannel.TELEGRAM]
    assert payload.source == EventSource.TELEGRAM_TEXT
    assert payload.status == EventStatus.DRAFT
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
    settings = Settings(
        telegram_user_id="42", telegram_bot_token="123:abc", llm_api_key="test-key"
    )
    store = DraftStore()
    http = _FakeHttp(_parse_response())
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
        http_client=http,
        draft_store=store,
    )
    assert reply is not None
    assert "📝 Dentist" in reply.text
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


def test_pending_helpers() -> None:
    """Pending/confirmation replies and the add-flow peek are pure."""
    from app.telegram_inbound import (
        is_add_flow_text,
        pending_add_reply,
        saved_confirmation_reply,
        voice_pending_reply,
        wants_pending_for_text_update,
    )

    assert "⏳" in pending_add_reply()
    assert "🎙" in voice_pending_reply()
    assert saved_confirmation_reply("Dentist") == "✅ Saved: Dentist"
    assert is_add_flow_text("/add dentist tomorrow") is True
    assert is_add_flow_text("Hanging on the bar for 2 minutes") is True
    assert is_add_flow_text("/today") is False
    assert is_add_flow_text("/add") is False
    assert is_add_flow_text("   ") is False
    assert is_add_flow_text(None) is False

    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    plain = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "hello there")
    )
    fast = _FakeUpdate(_FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "/today"))
    stranger = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(999), "hello there")
    )
    group = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "group"), _FakeUser(42), "hello there")
    )
    assert wants_pending_for_text_update(plain, settings) is True
    assert wants_pending_for_text_update(fast, settings) is False
    assert wants_pending_for_text_update(stranger, settings) is False
    assert wants_pending_for_text_update(group, settings) is False


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


class _FakeResponse:
    def __init__(self, data: object, status_code: int = 200) -> None:
        self.status_code = status_code
        self._data = data

    def json(self) -> object:
        return self._data


class _FakeHttp:
    """A fake HTTP client returning a canned parse response."""

    def __init__(self, data: object, status_code: int = 200) -> None:
        self._data = data
        self._status_code = status_code

    def post(self, url: str, *, headers: dict, json: dict) -> _FakeResponse:
        return _FakeResponse(self._data, self._status_code)


class _FakeCallback:
    def __init__(self, data: str, user_id: int, chat_id: int) -> None:
        self.data = data
        self.from_user = _FakeUser(user_id)
        self.message = _FakeMessage(
            _FakeChat(chat_id, "private"), _FakeUser(user_id), "/add x"
        )


def _parse_response() -> dict:
    """A canned successful parse response with one draft."""
    return {
        "events": [
            {
                "title": "Dentist",
                "start_at": "2026-01-02T09:00:00+00:00",
                "priority": "medium",
                "type": "one_time",
                "tz": "UTC",
                "channels": ["telegram"],
            }
        ]
    }


def test_handle_update_add_presents_draft_card(
    session_factory: sessionmaker[Session],
) -> None:
    """/add parses and returns a draft card with buttons; draft is stored."""
    settings = Settings(
        telegram_user_id="42", telegram_bot_token="123:abc", llm_api_key="test-key"
    )
    store = DraftStore()
    http = _FakeHttp(_parse_response())
    update = _FakeUpdate(
        _FakeMessage(
            _FakeChat(123, "private"), _FakeUser(42), "/add dentist tomorrow 9am"
        )
    )
    reply = _handle_update(
        update,
        settings,
        session_factory,
        now=_now(),
        http_client=http,
        draft_store=store,
    )
    assert reply is not None
    assert "📝 Dentist" in reply.text
    assert reply.reply_markup == [
        [
            ("💾 Save", "draft:save:0"),
            ("✏️ Edit", "draft:edit:0"),
            ("🗑 Discard", "draft:discard:0"),
        ]
    ]
    pending = store.get(123)
    assert pending is not None
    assert pending.raw_input == "dentist tomorrow 9am"
    assert len(pending.drafts) == 1
    # Inbound record is persisted with message_type "draft".
    with session_factory() as session:
        assert session.query(TelegramInbound).one().message_type == "draft"


def test_handle_update_add_unavailable() -> None:
    """/add with no LLM key returns a plain-text availability reply."""
    settings = Settings(
        telegram_user_id="42", telegram_bot_token="123:abc", llm_api_key=None
    )
    store = DraftStore()
    update = _FakeUpdate(
        _FakeMessage(
            _FakeChat(123, "private"), _FakeUser(42), "/add dentist tomorrow 9am"
        )
    )
    reply = _handle_update(
        update,
        settings,
        None,
        now=_now(),
        http_client=_FakeHttp(_parse_response()),
        draft_store=store,
    )
    assert reply is not None
    assert "AI parsing isn't configured" in reply.text
    assert reply.reply_markup is None
    assert store.get(123) is None


def test_handle_update_add_needs_clarification() -> None:
    """/add that needs clarification replies with the message and stores nothing."""
    settings = Settings(
        telegram_user_id="42", telegram_bot_token="123:abc", llm_api_key="test-key"
    )
    store = DraftStore()
    http = _FakeHttp({"needs_clarification": True, "message": "When is it?"})
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "/add something vague")
    )
    reply = _handle_update(
        update, settings, None, now=_now(), http_client=http, draft_store=store
    )
    assert reply is not None
    assert reply.text == "When is it?"
    assert store.get(123) is None


def test_handle_update_add_no_parse_client() -> None:
    """/add without a parse client replies that parsing is unavailable."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(
        _FakeMessage(
            _FakeChat(123, "private"), _FakeUser(42), "/add dentist tomorrow 9am"
        )
    )
    reply = _handle_update(
        update, settings, None, now=_now(), http_client=None, draft_store=DraftStore()
    )
    assert reply is not None
    assert "AI parsing isn't available" in reply.text


def test_handle_update_add_parse_error() -> None:
    """/add with a failing parse returns the error and stores nothing."""
    settings = Settings(
        telegram_user_id="42", telegram_bot_token="123:abc", llm_api_key="test-key"
    )
    store = DraftStore()
    http = _FakeHttp({"events": []}, status_code=500)
    update = _FakeUpdate(
        _FakeMessage(
            _FakeChat(123, "private"), _FakeUser(42), "/add dentist tomorrow 9am"
        )
    )
    reply = _handle_update(
        update, settings, None, now=_now(), http_client=http, draft_store=store
    )
    assert reply is not None
    assert "Couldn't parse that" in reply.text
    assert store.get(123) is None


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

    settings = Settings(
        telegram_bot_token="123:abc", telegram_user_id="42", llm_api_key="test-key"
    )
    store = DraftStore()
    http = _FakeHttp(_parse_response())
    app = build_telegram_inbound_application(
        settings, session_factory, now=_now(), http_client=http, draft_store=store
    )
    assert app is not None
    handler = app.handlers[0][0].callback

    sent: list[tuple[str, object]] = []

    class _ReplyMessage(_FakeMessage):
        async def reply_text(self, text: str, **kwargs: object) -> None:
            sent.append((text, kwargs))

    update = _FakeUpdate(
        _ReplyMessage(
            _FakeChat(123, "private"), _FakeUser(42), "/add dentist tomorrow 9am"
        )
    )
    asyncio.run(handler(update, None))

    # Pending ack first, then the draft card with an inline keyboard.
    assert len(sent) == 2
    assert "⏳" in sent[0][0]
    text, kwargs = sent[1]
    assert "📝 Dentist" in text
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
        assert event.status == EventStatus.DRAFT
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


# --- voice messages (issue #111) -----------------------------------------------


class _FakeVoice:
    def __init__(self, file_id: str | None = "FILE123", duration: float | None = 2.0):
        self.file_id = file_id
        self.duration = duration


class _FakeVoiceMessage(_FakeMessage):
    """A voice message: no text, a ``voice`` attachment."""

    def __init__(
        self,
        chat: _FakeChat,
        user: _FakeUser,
        file_id: str | None = "FILE123",
        duration: float | None = 2.0,
        message_id: int = 7,
    ) -> None:
        super().__init__(chat, user, None, message_id)
        self.voice = _FakeVoice(file_id, duration)


class _FakeVoiceUpdate:
    def __init__(self, message: _FakeVoiceMessage) -> None:
        self.effective_message = message
        self.message = message


class _FakeTelegramFile:
    """A fake PTB file that 'downloads' by writing bytes to the target path."""

    def __init__(self, calls: list[str]) -> None:
        self._calls = calls

    async def download_to_drive(self, path: str) -> None:
        self._calls.append(f"download:{path}")
        Path(path).write_bytes(b"OGGDATA")


class _FakeBot:
    """A fake bot whose ``get_file`` returns a downloadable fake file."""

    def __init__(self, calls: list[str], *, fail: bool = False) -> None:
        self._calls = calls
        self._fail = fail

    async def get_file(self, file_id: str) -> _FakeTelegramFile:
        if self._fail:
            raise RuntimeError("file download failed")
        self._calls.append(f"get_file:{file_id}")
        return _FakeTelegramFile(self._calls)


def _voice_transcriber(
    result: SttResult, seen: list[tuple[str, float | None]]
) -> object:
    """A fake VoiceTranscriber recording (ogg_path, duration) calls."""

    def transcribe(
        ogg_path: str, duration: float | None, settings: Settings
    ) -> SttResult:
        seen.append((ogg_path, duration))
        return result

    return transcribe


def test_voice_unavailable_reply_points_at_text_path() -> None:
    """The unavailable reply is explicit and points at the /add text path."""
    reply = voice_unavailable_reply()
    assert "voice transcription isn't available" in reply.lower()
    assert "/add" in reply


def test_voice_error_reply_formats_detail() -> None:
    """The error reply includes the detail (or 'unknown error')."""
    assert "boom" in voice_error_reply("boom")
    assert "unknown error" in voice_error_reply(None)


def test_handle_voice_update_gates() -> None:
    """Group chats, non-allowed users, and non-voice messages are ignored."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    group = _FakeUpdate(_FakeVoiceMessage(_FakeChat(123, "group"), _FakeUser(42)))
    stranger = _FakeUpdate(_FakeVoiceMessage(_FakeChat(123, "private"), _FakeUser(999)))

    assert asyncio.run(_handle_voice_update(group, settings)) is None
    assert asyncio.run(_handle_voice_update(stranger, settings)) is None
    assert asyncio.run(_handle_voice_update(_FakeUpdate(None), settings)) is None
    # A text message (no voice attribute) is not a voice update.
    text_update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "hello")
    )
    assert asyncio.run(_handle_voice_update(text_update, settings)) is None


def test_handle_voice_update_allows_any_allowlisted_user() -> None:
    """A voice DM from a second allowlisted id passes the gate (issue #112)."""
    settings = Settings(telegram_user_ids="42,222", telegram_bot_token="123:abc")
    update = _FakeUpdate(
        _FakeVoiceMessage(_FakeChat(123, "private"), _FakeUser(222), file_id=None)
    )
    # The gate passed: the update reaches the voice handling and replies the
    # transcription-unavailable error (a denied user would return None).
    reply = asyncio.run(_handle_voice_update(update, settings, bot=None))
    assert reply is not None


def test_handle_voice_update_denial_logs_one_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A voice message from a non-allowlisted user logs exactly one warning."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    stranger = _FakeUpdate(_FakeVoiceMessage(_FakeChat(123, "private"), _FakeUser(999)))
    with caplog.at_level(logging.WARNING):
        assert asyncio.run(_handle_voice_update(stranger, settings)) is None
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1


@pytest.mark.parametrize("kwargs", [{"file_id": None}, {}, {"bot": None}])
def test_handle_voice_update_missing_file_or_bot_replies_error(
    kwargs: dict,
) -> None:
    """A voice message without file_id or bot gets an explicit error reply."""
    import asyncio

    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    message = _FakeVoiceMessage(_FakeChat(123, "private"), _FakeUser(42))
    if "file_id" in kwargs:
        message.voice.file_id = kwargs["file_id"]
    update = _FakeUpdate(message)
    reply = asyncio.run(_handle_voice_update(update, settings, bot=kwargs.get("bot")))
    assert reply is not None
    assert "voice file is unavailable" in reply.text


def test_handle_voice_update_unavailable_stt_replies_clearly() -> None:
    """No local STT (Docker) -> clear 'voice transcription unavailable' reply."""
    import asyncio

    calls: list[str] = []
    seen: list[tuple[str, float | None]] = []
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(_FakeVoiceMessage(_FakeChat(123, "private"), _FakeUser(42)))
    reply = asyncio.run(
        _handle_voice_update(
            update,
            settings,
            bot=_FakeBot(calls),
            transcribe=_voice_transcriber(SttResult(ok=False, unavailable=True), seen),
        )
    )
    assert reply is not None
    assert "voice transcription isn't available" in reply.text.lower()
    assert "/add" in reply.text
    # The file is downloaded first (get_file + download_to_drive); only the
    # transcription step then reports local STT as unavailable.
    assert len(calls) == 2
    assert calls[0] == "get_file:FILE123"
    assert calls[1].startswith("download:")
    assert len(seen) == 1


def test_handle_voice_update_transcription_error_replies() -> None:
    """A failed transcription gets an explicit error reply, not silence."""
    import asyncio

    calls: list[str] = []
    seen: list[tuple[str, float | None]] = []
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(_FakeVoiceMessage(_FakeChat(123, "private"), _FakeUser(42)))
    reply = asyncio.run(
        _handle_voice_update(
            update,
            settings,
            bot=_FakeBot(calls),
            transcribe=_voice_transcriber(
                SttResult(ok=False, error="ffmpeg missing"), seen
            ),
        )
    )
    assert reply is not None
    assert "couldn't transcribe" in reply.text.lower()
    assert "ffmpeg missing" in reply.text


def test_handle_voice_update_empty_transcription_replies_error() -> None:
    """A 'successful' transcription with empty text gets the error reply."""
    import asyncio

    calls: list[str] = []
    seen: list[tuple[str, float | None]] = []
    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(_FakeVoiceMessage(_FakeChat(123, "private"), _FakeUser(42)))
    store = DraftStore()
    reply = asyncio.run(
        _handle_voice_update(
            update,
            settings,
            bot=_FakeBot(calls),
            draft_store=store,
            transcribe=_voice_transcriber(SttResult(ok=True, text=""), seen),
        )
    )
    assert reply is not None
    assert "couldn't transcribe" in reply.text.lower()
    assert "unknown error" in reply.text
    # An empty transcript never reaches the parse -> draft flow.
    assert store.get(123) is None


def test_handle_voice_update_download_failure_replies_error() -> None:
    """A download failure (bot.get_file raises) replies with the error."""
    import asyncio

    settings = Settings(telegram_user_id="42", telegram_bot_token="123:abc")
    update = _FakeUpdate(_FakeVoiceMessage(_FakeChat(123, "private"), _FakeUser(42)))
    reply = asyncio.run(
        _handle_voice_update(
            update, settings, bot=_FakeBot([], fail=True), transcribe=None
        )
    )
    assert reply is not None
    assert "file download failed" in reply.text


def test_handle_voice_update_success_routes_to_draft_flow(
    session_factory: sessionmaker[Session],
) -> None:
    """A transcribed voice message follows the same parse -> draft flow as /add."""
    import asyncio

    calls: list[str] = []
    seen: list[tuple[str, float | None]] = []

    def transcribe(
        ogg_path: str, duration: float | None, settings: Settings
    ) -> SttResult:
        assert Path(ogg_path).exists()  # downloaded file exists during transcription
        seen.append((ogg_path, duration))
        return SttResult(ok=True, text="dentist tomorrow 9am")

    settings = Settings(
        telegram_user_id="42", telegram_bot_token="123:abc", llm_api_key="test-key"
    )
    store = DraftStore()
    http = _FakeHttp(_parse_response())
    update = _FakeUpdate(_FakeVoiceMessage(_FakeChat(123, "private"), _FakeUser(42)))
    reply = asyncio.run(
        _handle_voice_update(
            update,
            settings,
            session_factory,
            bot=_FakeBot(calls),
            now=_now(),
            http_client=http,
            draft_store=store,
            transcribe=transcribe,
        )
    )
    assert reply is not None
    assert "📝 Dentist" in reply.text
    assert reply.reply_markup == [
        [
            ("💾 Save", "draft:save:0"),
            ("✏️ Edit", "draft:edit:0"),
            ("🗑 Discard", "draft:discard:0"),
        ]
    ]
    pending = store.get(123)
    assert pending is not None
    assert pending.raw_input == "dentist tomorrow 9am"
    # The temp .ogg file was removed after transcription.
    assert seen and not Path(seen[0][0]).exists()
    # Inbound record is persisted with message_type "draft".
    with session_factory() as session:
        assert session.query(TelegramInbound).one().message_type == "draft"


def test_transcribe_voice_message_always_deletes_temp_file() -> None:
    """The temp .ogg is deleted even when transcription raises."""
    import asyncio

    calls: list[str] = []
    seen: list[tuple[str, float | None]] = []

    def transcribe(
        ogg_path: str, duration: float | None, settings: Settings
    ) -> SttResult:
        seen.append((ogg_path, duration))
        raise RuntimeError("voxtype exploded")

    with pytest.raises(RuntimeError, match="voxtype exploded"):
        asyncio.run(
            _transcribe_voice_message(
                _FakeBot(calls),
                "FILE123",
                2.0,
                Settings(telegram_user_id="42", telegram_bot_token="123:abc"),
                transcribe=transcribe,
            )
        )
    assert seen and not Path(seen[0][0]).exists()


def test_build_telegram_inbound_application_voice_handler(
    session_factory: sessionmaker[Session],
) -> None:
    """The registered VOICE handler transcribes and replies via the bot."""
    import asyncio

    settings = Settings(
        telegram_user_id="42", telegram_bot_token="123:abc", llm_api_key="test-key"
    )
    store = DraftStore()
    http = _FakeHttp(_parse_response())
    app = build_telegram_inbound_application(
        settings,
        session_factory,
        now=_now(),
        http_client=http,
        draft_store=store,
        transcribe=lambda path, duration, s: SttResult(
            ok=True, text="dentist tomorrow 9am"
        ),
    )
    assert app is not None
    voice_handler = app.handlers[0][1].callback  # [0]=text, [1]=voice, [2]=callback

    calls: list[str] = []
    replied: list[str] = []

    class _ReplyVoiceMessage(_FakeVoiceMessage):
        async def reply_text(self, text: str, **kwargs: object) -> None:
            replied.append(text)

    class _FakeContext:
        bot = _FakeBot(calls)

    update = _FakeUpdate(_ReplyVoiceMessage(_FakeChat(123, "private"), _FakeUser(42)))

    asyncio.run(voice_handler(update, _FakeContext()))

    # Pending ack first, then the draft card.
    assert len(replied) == 2
    assert "🎙" in replied[0]
    assert "📝 Dentist" in replied[1]
    pending = store.get(123)
    assert pending is not None and len(pending.drafts) == 1
