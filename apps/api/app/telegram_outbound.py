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
(``should_push``), the inline callback-data codec (``callback_data`` /
``parse_callback_data``) and the per-action state transitions
(``ack_delivery``, ``snooze_delivery``, ``delete_delivery``). The impure
Telegram wiring (``send_reminder_card`` / ``make_telegram_job_func``) is a
thin adapter over python-telegram-bot v21 (polling) and is kept to a minimum.

Only allowlisted Telegram users (``settings.telegram_allowlist`` —
``TELEGRAM_USER_IDS`` combined with the legacy ``TELEGRAM_USER_ID``, issue
#112) receive cards; with an empty allowlist nothing is sent (fail closed).
Low priority events are never pushed (``should_push``). The bot never sends a
card when no bot token is configured.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session, sessionmaker

from .config import Settings
from .enums import EventChannel, EventPriority
from .models import DeliveryLog, Event
from .scheduler import (
    PlannedReminder,
    add_reminder_job,
    base_occurrence_id,
    channel_allows,
    deliver_reminder,
    quiet_hours_run_time,
    reminder_run_time,
    repeat_until_ack_plan,
    should_repeat_until_ack,
)

logger = logging.getLogger(__name__)

#: Separator used inside inline button callback data (never appears in the
#: occurrence id or offset, unlike ``:`` which appears in ISO timestamps).
_CB_SEP = "|"

#: How long a Snooze defers a reminder before it is re-sent.
_SNOOZE_DELTA = timedelta(days=1)

#: A delivery firing later than this after its planned run time renders as a
#: retrospective "missed" card. Covers both the startup catch-up jobs and
#: normal jobs that misfired while the service was down (APScheduler grace).
_MISSED_THRESHOLD = timedelta(minutes=5)

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
    tz: str


def _card_zone(tz: str | None) -> tzinfo:
    """The event's IANA zone for card rendering, falling back to UTC.

    A reminder delivery must never crash because of a bad timezone string, so
    a missing/empty/unknown ``tz`` renders as UTC (the pre-#131 behavior).
    """
    if tz:
        try:
            return ZoneInfo(tz)
        except (ValueError, ZoneInfoNotFoundError):
            pass
    return UTC


def priority_emoji(priority: EventPriority) -> str:
    """Return the emoji for a priority (defaults to the medium bell)."""
    return _PRIORITY_EMOJI.get(priority, _PRIORITY_EMOJI[EventPriority.MEDIUM])


def should_push(priority: EventPriority) -> bool:
    """Whether a priority warrants a proactive push (low priority is suppressed).

    Low-priority events are recorded but never proactively pushed to Telegram.
    """
    return priority != EventPriority.LOW


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


def overdue_text(target: datetime, now: datetime) -> str:
    """Human overdue duration from ``target`` to ``now``, e.g. ``"2h 15m ago"``.

    Inverse of :func:`countdown_text` for retrospective ("missed") cards.
    Returns ``"now"`` when ``now`` is not after ``target``.
    """
    elapsed = now - target
    if elapsed <= timedelta(0):
        return "now"
    total_minutes = int(elapsed.total_seconds() // 60)
    if total_minutes < 1:
        return "just now"
    days, remainder = divmod(total_minutes, 24 * 60)
    if days:
        hours, minutes = divmod(remainder, 60)
        if hours:
            return f"{days}d {hours}h ago"
        return f"{days}d ago"
    hours, minutes = divmod(total_minutes, 60)
    if hours:
        return f"{hours}h {minutes}m ago" if minutes else f"{hours}h ago"
    return f"{minutes}m ago"


def format_reminder_card(
    event: _CardEvent,
    occurrence_id: str,
    offset: str,
    now: datetime | None = None,
    *,
    is_missed: bool = False,
) -> str:
    """Build the Telegram priority card for a delivered reminder.

    The card shows an emoji, the event title, the occurrence date/time, a
    countdown to the occurrence, and the event notes (description). ``offset``
    is the reminder offset that fired (e.g. ``"1h"``).

    The occurrence is rendered in the event's own IANA timezone (``event.tz``,
    issue #131): a naive ``start_at`` is the wall clock in that zone (how the
    web UI stores it), and an aware value is converted into the zone. An
    unknown/missing ``tz`` falls back to UTC. Formatting the raw stored value
    as UTC wall-clock was the -4h shift the owner saw on every reminder card.

    When ``is_missed`` is True the card is a retrospective catch-up (the
    reminder came due while the service was down): it is prefixed with a
    ``⚠️ Missed reminder`` header explaining the outage and the countdown
    reads as overdue (``"3h ago"``) instead of ``"in …"``/``"now"``.
    """
    now = now or datetime.now(UTC)
    start = event.start_at
    zone = _card_zone(getattr(event, "tz", None))
    # Datetimes are stored naive (wall clock in the event's own tz) in SQLite;
    # make the value aware for the countdown math, then render it in the
    # event's own zone so the card matches the web UI and the create modal.
    if start.tzinfo is None:
        start = start.replace(tzinfo=zone)
    local = start.astimezone(zone)
    emoji = priority_emoji(event.priority)
    timing = overdue_text(start, now) if is_missed else countdown_text(start, now)
    lines: list[str] = []
    if is_missed:
        lines.append("⚠️ Missed reminder — service was down, sending retrospectively")
        lines.append(f"{emoji} {event.title}")
    else:
        lines.append(f"{emoji} {event.title}")
    lines.append(f"🕐 {local:%a, %b %d, %Y} {local:%H:%M} ({timing})")
    lines.append(f"⏳ reminder {offset} before")
    if event.description:
        lines.append(f"📝 {event.description}")
    lines.append(f"`{occurrence_id}`")
    return "\n".join(lines)


def _occurrence_start_utc(occurrence_id: str, tz: str | None) -> datetime | None:
    """Parse an occurrence id back to its aware UTC start (best-effort).

    Returns None when the id is not a parseable timestamp (e.g. synthetic
    test ids like ``"occ-1"``) so missed detection fails open to a normal
    card instead of crashing the delivery.
    """
    base = base_occurrence_id(occurrence_id)
    try:
        from datetime import date as _date

        try:
            parsed = datetime.fromisoformat(base)
        except ValueError:
            parsed = datetime.combine(_date.fromisoformat(base), datetime.min.time())
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=_card_zone(tz))
        return parsed.astimezone(UTC)
    except (ValueError, TypeError, OverflowError):
        return None


def is_missed_delivery(
    event: Any,
    occurrence_id: str,
    offset: str,
    now: datetime,
    *,
    threshold: timedelta = _MISSED_THRESHOLD,
) -> bool:
    """Whether a firing reminder came due long enough ago to count as missed.

    Recomputes the planned run time (same ``reminder_run_time`` + quiet-hours
    deferral as the scheduler) from the occurrence start and reports True when
    it is older than ``threshold``. Any unparseable input returns False so a
    normal on-time card is sent rather than dropping the reminder.
    """
    try:
        occ_start = _occurrence_start_utc(occurrence_id, getattr(event, "tz", None))
        if occ_start is None:
            return False
        run_at = reminder_run_time(
            occ_start,
            offset,
            getattr(event, "remind_time_of_day", None),
            getattr(event, "tz", None) or "UTC",
        )
        run_at = quiet_hours_run_time(
            run_at,
            getattr(event, "quiet_hours_start", None),
            getattr(event, "quiet_hours_end", None),
            getattr(event, "tz", None) or "UTC",
        )
        return run_at < now - threshold
    except Exception:  # noqa: BLE001 - missed detection must never break delivery
        return False


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
    event_id: int,
    occurrence_id: str,
    offset: str,
    *,
    snooze_allowed: bool = True,
) -> dict[str, Any]:
    """Return the Telegram inline-keyboard markup for the action buttons.

    When ``snooze_allowed`` is False the Snooze button is omitted (per-event
    ``snooze_allowed`` config, issue #62).
    """
    ack = {
        "text": _ACTION_LABELS[_ACTION_ACK],
        "callback_data": callback_data(_ACTION_ACK, event_id, occurrence_id, offset),
    }
    delete = {
        "text": _ACTION_LABELS[_ACTION_DELETE],
        "callback_data": callback_data(_ACTION_DELETE, event_id, occurrence_id, offset),
    }
    if snooze_allowed:
        snooze = {
            "text": _ACTION_LABELS[_ACTION_SNOOZE],
            "callback_data": callback_data(
                _ACTION_SNOOZE, event_id, occurrence_id, offset
            ),
        }
        buttons = [[ack, snooze, delete]]
    else:
        buttons = [[ack, delete]]
    return {"inline_keyboard": buttons}


# --- action state transitions (pure, DB-backed) ------------------------------


def ack_delivery(
    session: Session, event_id: int, occurrence_id: str, offset: str
) -> bool:
    """Mark the delivered reminder as acknowledged.

    Updates the ``sent`` DeliveryLog for the reminder to ``acked`` and returns
    True when a matching log was updated. Repeat/snooze follow-up deliveries
    trace back to their base occurrence so acknowledging any of them stops the
    repeat-until-ack loop.
    """
    base = base_occurrence_id(occurrence_id)
    log = (
        session.query(DeliveryLog)
        .filter_by(
            event_id=event_id,
            occurrence_id=base,
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
    scheduler with the same job function, unless the event's ``snooze_allowed``
    is False (issue #62). Returns a human message for the bot to answer the
    callback query with.
    """
    parsed = parse_callback_data(data)
    if parsed is None:
        return "Invalid action"
    action, event_id, occurrence_id, offset = parsed
    if action == _ACTION_ACK:
        ok = ack_delivery(session, event_id, occurrence_id, offset)
        return "Acknowledged ✓" if ok else "Nothing to acknowledge"
    if action == _ACTION_SNOOZE:
        if not snooze_allowed_for_event(session, event_id):
            return "Snooze not allowed"
        planned = snooze_delivery(session, event_id, occurrence_id, offset, now=now)
        if planned is None:
            return "Nothing to snooze"
        add_reminder_job(scheduler, planned, job_func)
        return "Snoozed for 1 day 😴"
    if action == _ACTION_DELETE:
        ok = delete_delivery(session, event_id, occurrence_id, offset)
        return "Reminder deleted 🗑" if ok else "Nothing to delete"
    return "Unknown action"


def snooze_allowed_for_event(session: Session, event_id: int) -> bool:
    """Whether the event allows snoozing (per-event ``snooze_allowed``).

    Returns False when the event is missing or its ``snooze_allowed`` is False,
    so a Snooze callback never re-schedules a reminder the event forbids.
    """
    event = session.get(Event, event_id)
    if event is None:
        return False
    return bool(event.snooze_allowed)


# --- impure wiring (python-telegram-bot v21) ---------------------------------


#: Live Telegram reminder job functions by stable context key.
#:
#: APScheduler's persistent SQLite jobstore serializes every scheduled job via
#: a textual ``module:function`` reference (``apscheduler.util.obj_to_ref``),
#: which explicitly rejects ``functools.partial``, lambdas and nested
#: functions. Scheduling the closure built by :func:`make_telegram_job_func`
#: (or a partial of the dispatcher) therefore raises ``ValueError`` the moment
#: the scheduler starts with any job present. That took down the whole
#: Telegram/scheduler stack at startup: the drain schedules jobs for every
#: active event, so any seeded or real event made ``start_runtime`` fail with
#: ``telegram: error`` (and ``scheduler: disabled``) on /healthz and the bot
#: never polled (no reply to any DM). The scheduler therefore stores the
#: module-level :func:`telegram_reminder_job`; at fire time the dispatcher
#: looks the live closure back up here. The key is stable across restarts so
#: jobs persisted by a previous process still resolve after ``start_runtime``
#: re-registers the fresh closure.
_JOB_FUNC_REGISTRY: dict[str, Callable[[int, str, str], bool]] = {}

#: Stable registry key for the production Telegram reminder job function.
TELEGRAM_JOB_CONTEXT_KEY = "telegram-reminders"


def run_telegram_reminder_job(
    context_key: str, event_id: int, occurrence_id: str, offset: str
) -> bool:
    """APScheduler entry point for Telegram reminders (must stay picklable).

    Looks up the live job closure registered under ``context_key`` by
    :func:`make_telegram_job_func` and runs it. Kept for backwards
    compatibility with any already-persisted jobs; new jobs use
    :func:`telegram_reminder_job` (a plain module-level function, which is
    what APScheduler's ``obj_to_ref`` can serialize — ``partial`` cannot).
    """
    try:
        job_func = _JOB_FUNC_REGISTRY[context_key]
    except KeyError:
        raise RuntimeError(
            f"telegram reminder job context {context_key!r} is not registered"
        ) from None
    return job_func(event_id, occurrence_id, offset)


def telegram_reminder_job(event_id: int, occurrence_id: str, offset: str) -> bool:
    """APScheduler entry point for Telegram reminders (serializable).

    Plain module-level function so APScheduler's SQLite jobstore can persist
    it as a ``module:function`` reference. Dispatches to the live closure
    registered under :data:`TELEGRAM_JOB_CONTEXT_KEY` by
    :func:`make_telegram_job_func`.
    """
    return run_telegram_reminder_job(
        TELEGRAM_JOB_CONTEXT_KEY, event_id, occurrence_id, offset
    )


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
    scheduler: Any = None,
    repeat_interval: timedelta | None = None,
) -> Callable[[int, str, str], bool]:
    """Build the scheduler job function that sends a due reminder to Telegram.

    The returned function matches the scheduler's job signature
    ``(event_id, occurrence_id, offset)`` and reuses ``deliver_reminder`` so the
    at-least-once / audit-trail semantics from the scheduler are preserved. It
    fails closed: no bot token, an empty/invalid allowlist, a low-priority
    event, or a channel the event isn't configured for means nothing is sent
    (issue #62). Every allowlisted user id (issue #112) receives the card;
    delivery is recorded once (sent or failed) regardless of recipient count.

    The returned callable is the module-level :func:`telegram_reminder_job`
    (not the closure itself), so it can be persisted by APScheduler's SQLite
    jobstore as a ``module:function`` reference — scheduling a closure, lambda
    or ``functools.partial`` raises and breaks startup. Pass the returned
    value (not the inner closure) to ``add_reminder_job`` /
    ``drain_schedule`` / ``requeue_failed`` and to ``handle_callback`` for
    snooze re-scheduling.

    When ``scheduler`` is provided and the event has ``repeat_until_ack`` set, a
    successfully delivered reminder that hasn't been acknowledged is re-scheduled
    (repeat-until-ack, issue #62).

    Late firings (catch-up jobs scheduled after an outage, or normal jobs that
    misfired while down) automatically render as retrospective "missed" cards
    via :func:`is_missed_delivery` — no extra job type or stored flag needed.
    """
    chat_ids = settings.telegram_allowlist.ids

    def job_func(event_id: int, occurrence_id: str, offset: str) -> bool:
        now_utc = now or datetime.now(UTC)

        def send() -> None:
            with session_factory() as session:
                event = session.get(Event, event_id)
                if event is None:
                    raise RuntimeError(f"event {event_id} not found")
                if not should_push(event.priority):
                    return None
                if not channel_allows(event.channels, EventChannel.TELEGRAM):
                    return None
                if not chat_ids:
                    raise PermissionError("telegram user not allowed")
                missed = is_missed_delivery(event, occurrence_id, offset, now_utc)
                text = format_reminder_card(
                    event, occurrence_id, offset, now=now_utc, is_missed=missed
                )
                for chat_id in chat_ids:
                    _run_send(
                        bot,
                        chat_id,
                        text,
                        event_id,
                        occurrence_id,
                        offset,
                        snooze_allowed=bool(event.snooze_allowed),
                    )

        delivered = deliver_reminder(
            session_factory,
            event_id,
            occurrence_id,
            offset,
            now=now_utc,
            send=send,
        )

        if delivered and scheduler is not None:
            with session_factory() as session:
                event = session.get(Event, event_id)
                if event is None:
                    return delivered
                acked = _is_acked(session_factory, event_id, occurrence_id, offset)
                if should_repeat_until_ack(event.repeat_until_ack, acked):
                    planned = repeat_until_ack_plan(
                        event,
                        occurrence_id,
                        offset,
                        now_utc,
                        repeat_interval=repeat_interval,
                    )
                    if planned is not None:
                        add_reminder_job(
                            scheduler,
                            planned,
                            telegram_reminder_job,
                        )
        return delivered

    _JOB_FUNC_REGISTRY[TELEGRAM_JOB_CONTEXT_KEY] = job_func
    return telegram_reminder_job


def _is_acked(
    session_factory: sessionmaker[Session],
    event_id: int,
    occurrence_id: str,
    offset: str,
) -> bool:
    """Whether the base delivery for a reminder has been acknowledged."""
    base = base_occurrence_id(occurrence_id)
    with session_factory() as session:
        return (
            session.query(DeliveryLog)
            .filter_by(
                event_id=event_id,
                occurrence_id=base,
                offset=offset,
                status=_STATUS_ACKED,
            )
            .first()
            is not None
        )


def _run_send(
    bot: _Bot,
    chat_id: int | None,
    text: str,
    event_id: int,
    occurrence_id: str,
    offset: str,
    *,
    snooze_allowed: bool = True,
) -> None:
    """Synchronously dispatch the async card send (thin adapter).

    Kept separate so the bot call can be injected/faked in tests; the async
    send is awaited through the running event loop.
    """
    if chat_id is None:
        raise RuntimeError("telegram chat id not configured")
    import asyncio

    coro = send_reminder_card(
        bot,
        chat_id,
        text,
        build_reply_markup(
            event_id, occurrence_id, offset, snooze_allowed=snooze_allowed
        ),
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
