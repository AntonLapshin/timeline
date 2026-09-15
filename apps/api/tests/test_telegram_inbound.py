"""Tests for the Telegram inbound DM command bot (issue #69, M5-T1).

Covers the acceptance criteria:

- **DM-only gate**: ``is_private_chat`` accepts only private chats; groups,
  supergroups and channels are ignored.
- **Allowlist rejection**: ``_handle_update`` ignores messages from users other
  than the configured ``TELEGRAM_USER_ID`` and from non-private chats.
- **Commands**: ``/today``, ``/upcoming [7d|30d]``, ``/low``, ``/add <text>``
  and ``/ask <question>`` each produce the expected reply; unknown commands get
  a usage hint.
- **No-token no-op**: ``build_telegram_inbound_application`` returns ``None``
  with no bot token (never polls).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.enums import EventPriority, EventSource, EventStatus, EventType
from app.models import Event, TelegramInbound
from app.telegram_inbound import (
    Command,
    _handle_update,
    build_inbound_record,
    build_telegram_inbound_application,
    events_low,
    events_today,
    events_upcoming,
    format_event_line,
    handle_command,
    is_private_chat,
    parse_command,
    parse_upcoming_days,
    record_inbound,
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


def test_handle_command_add_stub() -> None:
    """/add records the text and explains parsing isn't wired yet."""
    result = handle_command(Command("add", "dentist tomorrow 9am"), [], now=_now())
    assert result.message_type == "text"
    assert "dentist tomorrow 9am" in result.reply
    assert "AI parsing isn't wired up yet" in result.reply


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
    settings = Settings(telegram_user_id="42", telegram_bot_token="token")
    update = _FakeUpdate(_FakeMessage(_FakeChat(123, "group"), _FakeUser(42), "/today"))
    assert _handle_update(update, settings) is None


def test_handle_update_allowlist_rejection() -> None:
    """A private message from a non-allowed user is ignored."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="token")
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(999), "/today")
    )
    assert _handle_update(update, settings) is None


def test_handle_update_no_message() -> None:
    """An update with no message is ignored."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="token")
    assert _handle_update(_FakeUpdate(None), settings) is None


def test_handle_update_non_command_ignored() -> None:
    """Plain text (not a command) is ignored."""
    settings = Settings(telegram_user_id="42", telegram_bot_token="token")
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "hello")
    )
    assert _handle_update(update, settings) is None


def test_handle_update_today_replies_and_records(
    session_factory: sessionmaker[Session],
) -> None:
    """A private /today from the allowed user replies and records inbound."""
    with session_factory() as session:
        session.add(_event(start_at=_now() + timedelta(hours=1)))
        session.commit()

    settings = Settings(telegram_user_id="42", telegram_bot_token="token")
    update = _FakeUpdate(
        _FakeMessage(_FakeChat(123, "private"), _FakeUser(42), "/today")
    )
    reply = _handle_update(update, settings, session_factory, now=_now())
    assert reply is not None
    assert "📅 Today" in reply
    assert "Team standup" in reply

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
    app = build_telegram_inbound_application(
        settings, session_factory, now=_now()
    )
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
