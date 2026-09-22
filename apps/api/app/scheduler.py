"""Persistent, at-least-once reminder scheduler (issue #57, M4-T1).

APScheduler with a SQLite-backed jobstore (WAL, under ``./data``, gitignored)
so the job queue survives app restarts. Reminder jobs are keyed by a dedupe
key ``(event_id, occurrence_id, offset)`` so the same reminder is never
scheduled twice across restarts; a job whose run time fell while the app was
down is drained (run immediately) on startup. Delivery is at-least-once: a job
that fails is requeued rather than silently dropped, and every delivery attempt
is recorded in ``DeliveryLog`` (idempotent per key).

The pure helpers (``parse_offset``, ``dedupe_key``, ``schedule_plan``,
``with_retry``) carry no framework coupling and are unit-testable in isolation;
the APScheduler wiring (``build_scheduler``, ``add_reminder_job``,
``drain_schedule``, ``requeue_failed``) lives at the bottom and is the thin
impure layer. This is the scheduling foundation for the Telegram outbound
sender (M4-T2).
"""

from __future__ import annotations

import contextlib
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from apscheduler.jobstores.base import JobLookupError
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger
from sqlalchemy.orm import Session, sessionmaker

from .config import Settings
from .db import create_engine_from_settings
from .enums import EventChannel, EventPriority, EventStatus
from .models import DeliveryLog, Event
from .recurrence import next_occurrences

logger = logging.getLogger(__name__)

#: Filename of the persistent APScheduler jobstore DB (gitignored, under data).
_JOBSTORE_DB = "scheduler.db"

#: How many upcoming occurrences to consider per event when scheduling.
_MAX_OCCURRENCES = 64
#: How far ahead (in days) to schedule reminders.
_HORIZON_DAYS = 365
#: A job that missed its run time by less than this still fires on restart
#: (queue drained) rather than being silently dropped.
_MISFIRE_GRACE_SEC = 24 * 3600
#: Default lookback window (in days) for the startup retrospective catch-up:
#: reminders due inside ``[now - lookback, now]`` that were never delivered
#: (service was down) are re-sent on next startup with a "missed" card.
#: Bounded so startup stays O(active_events * occurrences_in_window).
_CATCHUP_LOOKBACK_DAYS = 7
#: Terminal delivery states: a reminder with any of these logs was already
#: handled and must never be re-sent by the catch-up (failed rows are left to
#: ``requeue_failed``; dedupe via the job key makes double-scheduling safe).
_DELIVERED_STATUSES = frozenset({"sent", "acked", "snoozed", "deleted"})
#: Default delay before retrying a failed delivery (at-least-once).
_RETRY_DELAY_SEC = 60
#: Default max retries for a failed delivery before giving up.
_MAX_RETRIES = 3

#: Suffix -> timedelta keyword for parsing reminder offsets ("7d", "2h", ...).
_OFFSET_UNITS: dict[str, str] = {
    "d": "days",
    "h": "hours",
    "m": "minutes",
    "w": "weeks",
}
_OFFSET_RE = re.compile(r"^(\d+)([dhmw])$")

#: Default quiet-hours window (22:00-08:00) applied when an event specifies no
#: per-event quiet hours (issue #62, M4-T3A).
_DEFAULT_QUIET_HOURS_START = "22:00"
_DEFAULT_QUIET_HOURS_END = "08:00"

#: Marker used in a repeat-until-ack occurrence id so the follow-up reminder
#: carries a distinct dedupe key while still tracing back to the base delivery.
_REPEAT_MARKER = "~repeat@"


@dataclass(frozen=True)
class PlannedReminder:
    """A reminder the scheduler wants to run for a concrete occurrence."""

    event_id: int
    occurrence_id: str
    offset: str
    run_at: datetime


class _SchedulableEvent(Protocol):
    """The subset of an event the scheduler reads (duck-typed).

    Includes the recurrence attributes consumed by ``app.recurrence`` plus the
    per-event reminder config (``reminder_offsets``, ``remind_time_of_day``)
    and ``id`` used for the dedupe key.
    """

    id: int
    tz: str
    rrule: str | None
    start_at: datetime
    end_at: datetime | None
    all_day: bool
    reminder_offsets: list[str]
    remind_time_of_day: str | None
    repeat_until_ack: bool
    channels: list[EventChannel]
    snooze_allowed: bool


def parse_offset(offset: str) -> timedelta:
    """Parse a reminder offset like ``"7d"``, ``"2h"`` or ``"30m"`` into a timedelta.

    Offsets are "remind X before the event", so a positive amount is subtracted
    from the occurrence start. Raises ``ValueError`` for malformed input.
    """
    match = _OFFSET_RE.fullmatch(offset.strip().lower())
    if match is None:
        raise ValueError(f"invalid reminder offset: {offset!r}")
    amount = int(match.group(1))
    unit = _OFFSET_UNITS[match.group(2)]
    return timedelta(**{unit: amount})


def dedupe_key(event_id: int, occurrence_id: str, offset: str) -> str:
    """Return the stable dedupe/job key for a reminder.

    The key ``{event_id}:{occurrence_id}:{offset}`` uniquely identifies a
    reminder so the same one is never scheduled twice across restarts.
    """
    return f"{event_id}:{occurrence_id}:{offset}"


def parse_dedupe_key(key: str) -> tuple[int, str, str]:
    """Inverse of :func:`dedupe_key`, returning ``(event_id, occurrence_id, offset)``.

    The occurrence id is an ISO timestamp that itself contains ``:``, so the
    event id is split on the first ``:`` and the offset on the last one, with
    the occurrence id in between.
    """
    event_id_s, rest = key.split(":", 1)
    occurrence_id, offset = rest.rsplit(":", 1)
    return int(event_id_s), occurrence_id, offset


def _parse_hhmm(value: str) -> tuple[int, int]:
    """Parse a ``"HH:MM"`` wall-clock string into ``(hour, minute)``."""
    hour_s, _, minute_s = value.partition(":")
    return int(hour_s), int(minute_s or "0")


def in_quiet_hours(
    run_at: datetime,
    quiet_hours_start: str | None,
    quiet_hours_end: str | None,
    tz: str,
) -> bool:
    """Whether ``run_at`` (UTC) falls inside the quiet-hours window in ``tz``.

    The window is expressed in the event's local wall clock and may wrap past
    midnight (the default 22:00-08:00). Missing values fall back to the default
    window. ``end`` is exclusive: a reminder exactly at quiet-hours end is not
    deferred.
    """
    start = quiet_hours_start or _DEFAULT_QUIET_HOURS_START
    end = quiet_hours_end or _DEFAULT_QUIET_HOURS_END
    local = run_at.astimezone(ZoneInfo(tz))
    start_h, start_m = _parse_hhmm(start)
    end_h, end_m = _parse_hhmm(end)
    start_min = start_h * 60 + start_m
    end_min = end_h * 60 + end_m
    local_min = local.hour * 60 + local.minute
    if start_min < end_min:
        # Same-day window, e.g. 08:00-22:00.
        return start_min <= local_min < end_min
    # Overnight window, e.g. 22:00-08:00.
    return local_min >= start_min or local_min < end_min


def defer_to_morning_digest(
    run_at: datetime,
    quiet_hours_end: str | None,
    tz: str,
) -> datetime:
    """Return the next local morning after quiet-hours end, strictly after ``run_at``.

    The digest is the quiet-hours end wall-clock on the day of ``run_at`` (or the
    next day when that instant is not later than ``run_at``), converted to UTC.
    """
    end = quiet_hours_end or _DEFAULT_QUIET_HOURS_END
    end_h, end_m = _parse_hhmm(end)
    local = run_at.astimezone(ZoneInfo(tz))
    digest = local.replace(hour=end_h, minute=end_m, second=0, microsecond=0)
    if digest <= local:
        digest += timedelta(days=1)
    return digest.astimezone(UTC)


def quiet_hours_run_time(
    run_at: datetime,
    quiet_hours_start: str | None,
    quiet_hours_end: str | None,
    tz: str,
) -> datetime:
    """Defer ``run_at`` to the next morning digest when it falls inside quiet hours.

    Reminders whose run time lands inside quiet hours are batched into a morning
    digest (the next morning after quiet-hours end) instead of pushing
    immediately. Run times outside quiet hours are returned unchanged.
    """
    if in_quiet_hours(run_at, quiet_hours_start, quiet_hours_end, tz):
        return defer_to_morning_digest(run_at, quiet_hours_end, tz)
    return run_at


def channel_allows(channels: list[EventChannel], channel: EventChannel) -> bool:
    """Whether an event's configured channels include ``channel``.

    Outbound delivery only pushes to channels the event is configured for; a
    channel that is absent (e.g. a Telegram-only event with email disabled) is
    never delivered on.
    """
    return channel in channels


def should_repeat_until_ack(repeat_until_ack: bool, acked: bool) -> bool:
    """Whether a reminder should be re-scheduled because it wasn't acknowledged.

    A ``repeat_until_ack`` event keeps re-scheduling a delivered reminder until
    the recipient acknowledges it; once acked (or when the flag is off) no
    further repeat is scheduled.
    """
    return repeat_until_ack and not acked


def base_occurrence_id(occurrence_id: str) -> str:
    """Return the base occurrence id, stripping any repeat/snooze markers.

    Follow-up deliveries (repeat-until-ack, snooze) use suffixed occurrence ids
    so their dedupe keys don't collide with the original; this strips the suffix
    so ack/state lookups can trace back to the base delivery.
    """
    for marker in (_REPEAT_MARKER, "~snooze@"):
        if marker in occurrence_id:
            return occurrence_id.split(marker, 1)[0]
    return occurrence_id


def repeat_until_ack_plan(
    event: _SchedulableEvent,
    occurrence_id: str,
    offset: str,
    delivered_at: datetime,
    *,
    repeat_interval: timedelta | None = None,
) -> PlannedReminder | None:
    """Return the follow-up reminder for a repeat-until-ack event, or None.

    When ``event.repeat_until_ack`` is set, a delivered reminder is re-scheduled
    ``repeat_interval`` (default one hour) later with a distinct occurrence id so
    it keeps firing until the recipient acknowledges. Returns None for events
    that don't repeat.
    """
    if not event.repeat_until_ack:
        return None
    interval = repeat_interval or timedelta(hours=1)
    repeat_occurrence = f"{occurrence_id}{_REPEAT_MARKER}{delivered_at:%Y%m%d%H%M%S}"
    return PlannedReminder(
        event_id=event.id,
        occurrence_id=repeat_occurrence,
        offset=offset,
        run_at=delivered_at + interval,
    )


def reminder_run_time(
    start: datetime,
    offset: str,
    remind_time_of_day: str | None,
    tz: str,
) -> datetime:
    """Compute the UTC run time for a reminder of an occurrence starting at ``start``.

    The base is ``start - offset``. When ``remind_time_of_day`` (``"HH:MM"``) is
    set, the run time is snapped to that local time-of-day (in the event's
    ``tz``) on the resulting day. Always returns a timezone-aware UTC datetime.
    """
    base = start - parse_offset(offset)
    if remind_time_of_day is None:
        return base
    hour_s, _, minute_s = remind_time_of_day.partition(":")
    local = base.astimezone(ZoneInfo(tz)).replace(
        hour=int(hour_s),
        minute=int(minute_s),
        second=0,
        microsecond=0,
    )
    return local.astimezone(UTC)


def schedule_plan(
    event: _SchedulableEvent,
    now: datetime,
    *,
    horizon_days: int = _HORIZON_DAYS,
    max_occurrences: int = _MAX_OCCURRENCES,
) -> list[PlannedReminder]:
    """Compute the upcoming reminder jobs for a single event (pure).

    Reads the per-event reminder config (``reminder_offsets``,
    ``remind_time_of_day``), expands upcoming occurrences via
    ``app.recurrence.next_occurrences``, and returns one ``PlannedReminder``
    per (occurrence, offset) whose run time is in the future and within the
    horizon. Results are sorted by run time.
    """
    offsets = list(event.reminder_offsets)
    if not offsets:
        return []
    occurrences = next_occurrences(event, max_occurrences, after=now)
    horizon = now + timedelta(days=horizon_days)
    quiet_start = getattr(event, "quiet_hours_start", None)
    quiet_end = getattr(event, "quiet_hours_end", None)
    plan: list[PlannedReminder] = []
    for occ in occurrences:
        for offset in offsets:
            run_at = reminder_run_time(
                occ.start, offset, event.remind_time_of_day, event.tz
            )
            run_at = quiet_hours_run_time(run_at, quiet_start, quiet_end, event.tz)
            if run_at < now or run_at > horizon:
                continue
            plan.append(
                PlannedReminder(
                    event_id=event.id,
                    occurrence_id=occ.occurrence_id,
                    offset=offset,
                    run_at=run_at,
                )
            )
    plan.sort(key=lambda p: p.run_at)
    return plan


def missed_reminders_plan(
    event: _SchedulableEvent,
    now: datetime,
    *,
    lookback_days: int = _CATCHUP_LOOKBACK_DAYS,
    max_occurrences: int = _MAX_OCCURRENCES,
) -> list[PlannedReminder]:
    """Compute reminders that came due while the service was down (pure).

    Expands occurrences starting at ``now - lookback_days`` and returns one
    ``PlannedReminder`` per (occurrence, offset) whose run time (same
    ``reminder_run_time`` + quiet-hours deferral as the forward plan) falls
    inside ``[window_start, now]``. Results are sorted by run time (oldest
    missed first, so the retrospective digest reads chronologically).

    Bounded by ``lookback_days`` (default 7d, covers the largest standard
    offset plus a realistic outage) and ``max_occurrences`` so startup stays
    performant; callers filter out already-delivered keys via ``DeliveryLog``.
    """

    offsets = list(event.reminder_offsets)
    if not offsets or lookback_days <= 0:
        return []
    window_start = now - timedelta(days=lookback_days)
    occurrences = next_occurrences(event, max_occurrences, after=window_start)
    quiet_start = getattr(event, "quiet_hours_start", None)
    quiet_end = getattr(event, "quiet_hours_end", None)
    plan: list[PlannedReminder] = []
    for occ in occurrences:
        for offset in offsets:
            run_at = reminder_run_time(
                occ.start, offset, event.remind_time_of_day, event.tz
            )
            run_at = quiet_hours_run_time(run_at, quiet_start, quiet_end, event.tz)
            if run_at < window_start or run_at > now:
                continue
            plan.append(
                PlannedReminder(
                    event_id=event.id,
                    occurrence_id=occ.occurrence_id,
                    offset=offset,
                    run_at=run_at,
                )
            )
    plan.sort(key=lambda p: p.run_at)
    return plan


def with_retry(
    func: Callable[..., object],
    *,
    max_retries: int = _MAX_RETRIES,
    retry_delay_sec: int = _RETRY_DELAY_SEC,
    requeue: Callable[[int], object] | None = None,
) -> Callable[..., object]:
    """Wrap a job function so a failure requeues it rather than dropping it.

    At-least-once delivery: after each failure ``requeue(remaining)`` is called
    so the caller can reschedule the job (e.g. with ``retry_delay_sec``). When
    the retry budget is exhausted the original exception is re-raised so the
    job is dropped and the error is surfaced upstream. ``retry_delay_sec`` is
    carried for the caller's requeue delay (the wrapper itself does not sleep).
    """
    remaining = {"n": max_retries}

    def wrapper(*args: object, **kwargs: object) -> object:
        try:
            return func(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 - retry any delivery failure
            if remaining["n"] <= 0:
                raise
            remaining["n"] -= 1
            logger.warning(
                "reminder delivery failed; requeuing in %ss (%d retries left): %s",
                retry_delay_sec,
                remaining["n"],
                exc,
            )
            if requeue is not None:
                requeue(remaining["n"])
            return None

    return wrapper


def deliver_reminder(
    session_factory: sessionmaker[Session],
    event_id: int,
    occurrence_id: str,
    offset: str,
    *,
    now: datetime | None = None,
    send: Callable[[], object] | None = None,
) -> bool:
    """Deliver a single reminder and record it in the audit trail (at-least-once).

    Idempotent per dedupe key: if a successful delivery for the same
    ``(event_id, occurrence_id, offset)`` already exists, this is a no-op that
    returns ``False``. ``send`` is the outbound channel (Telegram in M4-T2) and
    defaults to a no-op that always succeeds so the scheduling foundation can be
    tested without a live channel. On failure a ``DeliveryLog`` row is recorded
    with ``status="failed"`` and the exception is re-raised so the retry layer
    can requeue it.
    """
    now = now or datetime.now(UTC)
    send = send or (lambda: True)
    with session_factory() as session:
        existing = (
            session.query(DeliveryLog)
            .filter_by(
                event_id=event_id,
                occurrence_id=occurrence_id,
                offset=offset,
                status="sent",
            )
            .first()
        )
        if existing is not None:
            return False
        try:
            send()
        except Exception as exc:  # noqa: BLE001 - record + re-raise for retry
            session.add(
                DeliveryLog(
                    event_id=event_id,
                    occurrence_id=occurrence_id,
                    offset=offset,
                    status="failed",
                    scheduled_at=now,
                    error=str(exc),
                )
            )
            session.commit()
            raise
        session.add(
            DeliveryLog(
                event_id=event_id,
                occurrence_id=occurrence_id,
                offset=offset,
                status="sent",
                scheduled_at=now,
                sent_at=now,
            )
        )
        session.commit()
        return True


def build_scheduler(
    settings: Settings,
    *,
    misfire_grace_sec: int = _MISFIRE_GRACE_SEC,
    coalesce: bool = False,
) -> BackgroundScheduler:
    """Build a ``BackgroundScheduler`` with a persistent SQLite (WAL) jobstore.

    The jobstore lives in its own ``scheduler.db`` under ``settings.data_dir``
    (gitignored) and is WAL-enabled, so pending jobs survive app restarts. A
    generous ``misfire_grace_time`` means a job whose run time passed while the
    app was down still fires on restart (queue drained) rather than being
    dropped.
    """
    jobstore_settings = Settings(
        data_dir=settings.data_dir,
        db_name=_JOBSTORE_DB,
        wal_enabled=settings.wal_enabled,
    )
    engine = create_engine_from_settings(jobstore_settings)
    jobstores = {"default": SQLAlchemyJobStore(engine=engine)}
    return BackgroundScheduler(
        jobstores=jobstores,
        timezone=UTC,
        job_defaults={
            "misfire_grace_time": misfire_grace_sec,
            "coalesce": coalesce,
        },
    )


def add_reminder_job(
    scheduler: BackgroundScheduler,
    planned: PlannedReminder,
    job_func: Callable[..., object],
    *,
    now: datetime | None = None,
    jobstore: str = "default",
) -> str | None:
    """Schedule a reminder job, idempotent by dedupe key (at-least-once).

    The job id is the dedupe key ``(event_id, occurrence_id, offset)``, so
    scheduling the same reminder again is a no-op that returns ``None``. A
    reminder whose run time is already past (missed while down) is drained to
    run immediately. Returns the job id when a new job was added.
    """
    now = now or datetime.now(UTC)
    key = dedupe_key(planned.event_id, planned.occurrence_id, planned.offset)
    if scheduler.get_job(key, jobstore=jobstore) is not None:
        return None
    run_at = planned.run_at if planned.run_at >= now else now
    scheduler.add_job(
        job_func,
        trigger=DateTrigger(run_date=run_at),
        id=key,
        replace_existing=True,
        jobstore=jobstore,
        kwargs={
            "event_id": planned.event_id,
            "occurrence_id": planned.occurrence_id,
            "offset": planned.offset,
        },
    )
    return key


def drain_schedule(
    scheduler: BackgroundScheduler,
    session_factory: sessionmaker[Session],
    *,
    job_func: Callable[..., object],
    now: datetime | None = None,
    horizon_days: int = _HORIZON_DAYS,
    max_occurrences: int = _MAX_OCCURRENCES,
    jobstore: str = "default",
) -> int:
    """Drain the queue on startup: schedule upcoming reminders for all active events.

    Reads the per-event reminder config from the DB, computes upcoming
    occurrences, and registers reminder jobs (idempotent via the dedupe key).
    Missed reminders are drained to run immediately. Returns the number of jobs
    added.
    """
    now = now or datetime.now(UTC)
    added = 0
    with session_factory() as session:
        events = (
            session.query(Event)
            .filter(Event.status == EventStatus.ACTIVE)
            .order_by(Event.id)
            .all()
        )
        for event in events:
            for planned in schedule_plan(
                event,
                now,
                horizon_days=horizon_days,
                max_occurrences=max_occurrences,
            ):
                if (
                    add_reminder_job(
                        scheduler, planned, job_func, now=now, jobstore=jobstore
                    )
                    is not None
                ):
                    added += 1
    return added


def requeue_failed(
    scheduler: BackgroundScheduler,
    session_factory: sessionmaker[Session],
    *,
    job_func: Callable[..., object],
    now: datetime | None = None,
    jobstore: str = "default",
) -> int:
    """Requeue reminders whose delivery failed (at-least-once: nothing dropped).

    Scans ``DeliveryLog`` rows with ``status="failed"`` and re-adds their jobs
    (dedupe key) so they run again rather than being silently dropped. Returns
    the number of jobs requeued.
    """
    now = now or datetime.now(UTC)
    requeued = 0
    with session_factory() as session:
        failed = (
            session.query(DeliveryLog)
            .filter(DeliveryLog.status == "failed")
            .order_by(DeliveryLog.id)
            .all()
        )
        for log in failed:
            if log.occurrence_id is None or log.offset is None:
                continue
            planned = PlannedReminder(
                event_id=log.event_id,
                occurrence_id=log.occurrence_id,
                offset=log.offset,
                run_at=now,
            )
            if (
                add_reminder_job(
                    scheduler, planned, job_func, now=now, jobstore=jobstore
                )
                is not None
            ):
                requeued += 1
    return requeued


def catch_up_missed(
    scheduler: BackgroundScheduler,
    session_factory: sessionmaker[Session],
    *,
    job_func: Callable[..., object],
    now: datetime | None = None,
    lookback_days: int = _CATCHUP_LOOKBACK_DAYS,
    max_occurrences: int = _MAX_OCCURRENCES,
    jobstore: str = "default",
) -> int:
    """Send retrospectively what was due while the service was down (startup).

    For every active event, computes :func:`missed_reminders_plan` (reminders
    due in ``[now - lookback_days, now]``) and schedules the ones with no
    terminal ``DeliveryLog`` (``sent``/``acked``/``snoozed``/``deleted``) as
    immediate jobs via :func:`add_reminder_job` (drained to ``now``). The
    delivery itself renders a "missed" card (see ``app.telegram_outbound``),
    so the retrospective message is explicit about the outage.

    Why no extra "last-sent timestamp" table: ``DeliveryLog`` already records
    one row per delivered (event, occurrence, offset) instance — the exact
    per-instance record requested — and the bounded lookback keeps the scan
    performant (``O(active_events * occurrences_in_window)`` with two batched
    queries, no N+1). A single global timestamp would be fragile across clock
    changes and per-offset schedules, and would still need the per-instance
    check to stay idempotent.

    Skips low-priority events and events not configured for Telegram (they
    never push anyway), inactive events, and already-handled keys. Failed rows
    are left to :func:`requeue_failed` (dedupe makes double-scheduling safe).
    Returns the number of jobs scheduled.
    """
    now = now or datetime.now(UTC)
    if lookback_days <= 0:
        return 0
    with session_factory() as session:
        events = (
            session.query(Event)
            .filter(Event.status == EventStatus.ACTIVE)
            .order_by(Event.id)
            .all()
        )
        # Batch-load terminal delivery logs for these events once (no N+1):
        # only rows that prove a reminder was already handled.
        event_ids = [e.id for e in events]
        delivered: set[str] = set()
        if event_ids:
            logs = (
                session.query(
                    DeliveryLog.event_id,
                    DeliveryLog.occurrence_id,
                    DeliveryLog.offset,
                )
                .filter(
                    DeliveryLog.event_id.in_(event_ids),
                    DeliveryLog.status.in_(_DELIVERED_STATUSES),
                )
                .all()
            )
            delivered = {
                dedupe_key(eid, occ, off)
                for eid, occ, off in logs
                if occ is not None and off is not None
            }
    added = 0
    for event in events:
        if event.priority == EventPriority.LOW:
            continue
        if EventChannel.TELEGRAM not in (event.channels or []):
            continue
        for planned in missed_reminders_plan(
            event, now, lookback_days=lookback_days, max_occurrences=max_occurrences
        ):
            key = dedupe_key(planned.event_id, planned.occurrence_id, planned.offset)
            if key in delivered:
                continue
            if (
                add_reminder_job(
                    scheduler, planned, job_func, now=now, jobstore=jobstore
                )
                is not None
            ):
                added += 1
                delivered.add(key)  # same key twice in one pass -> schedule once
    return added


# --- runtime event re-scheduling (issue #134, M10-T1) ------------------------


def event_job_keys(
    scheduler: BackgroundScheduler,
    event_id: int,
    *,
    jobstore: str = "default",
) -> dict[str, datetime]:
    """List one event's pending reminder jobs as ``{key: next_run_time}``.

    Matches every job whose dedupe key starts with ``"{event_id}:"`` — the
    base plan jobs plus any pending ``~repeat@``/``~snooze@`` follow-ups
    (issue #62). Jobs that already ran (``next_run_time is None`` on a
    started scheduler) are not pending and are skipped. Note the
    ``trigger.run_date`` fallback (not-yet-started scheduler) can surface a
    lingering already-fired job with its past run date on a stopped
    scheduler; callers ignore past run times, so this is harmless.
    """
    prefix = f"{event_id}:"
    keys: dict[str, datetime] = {}
    for job in scheduler.get_jobs(jobstore=jobstore):
        key = str(job.id)
        if not key.startswith(prefix):
            continue
        # Started schedulers expose next_run_time; a not-yet-started one only
        # carries the trigger's run_date (pending jobs). Jobs with neither
        # have already fired and are not pending.
        run_at = getattr(job, "next_run_time", None)
        if run_at is None:
            run_at = getattr(job.trigger, "run_date", None)
        if run_at is not None:
            keys[key] = run_at
    return keys


def _is_followup_key(key: str) -> bool:
    """Whether a job key belongs to a repeat/snooze follow-up delivery."""
    _, occurrence_id, _ = parse_dedupe_key(key)
    return base_occurrence_id(occurrence_id) != occurrence_id


def plan_diff(
    existing: dict[str, datetime],
    desired: list[PlannedReminder],
) -> tuple[list[PlannedReminder], list[str]]:
    """Diff existing reminder jobs against a desired plan (pure).

    Returns ``(to_add, to_remove)``: desired reminders missing from
    ``existing`` or whose run time changed, and existing keys the desired plan
    no longer contains. Callers own the add/remove side effects (and any
    drained-job protection).
    """
    desired_keys = {dedupe_key(p.event_id, p.occurrence_id, p.offset) for p in desired}
    to_add: list[PlannedReminder] = []
    for planned in desired:
        key = dedupe_key(planned.event_id, planned.occurrence_id, planned.offset)
        if existing.get(key) != planned.run_at:
            to_add.append(planned)
    to_remove = [key for key in existing if key not in desired_keys]
    return to_add, to_remove


def reschedule_for_event(
    scheduler: BackgroundScheduler,
    event: _SchedulableEvent,
    job_func: Callable[..., object],
    *,
    now: datetime | None = None,
    jobstore: str = "default",
) -> tuple[int, int]:
    """Re-plan one event's reminder jobs on a running scheduler (impure).

    Diffs the desired ``schedule_plan(event)`` against the event's existing
    pending jobs and applies the delta: adds missing reminders, removes stale
    ones, and replaces jobs whose run time changed (e.g. a moved
    ``remind_time_of_day`` — ``add_reminder_job`` no-ops on an existing key,
    so the changed job is removed before being re-added). Returns
    ``(added, removed)`` counts.

    An event that is no longer ``ACTIVE`` (e.g. archived) gets no jobs at all
    — pending follow-ups with a future run time are dropped too (already-ran
    ones survive, mirroring the drained-job protection below). Pending
    ``~repeat@``/``~snooze@`` follow-ups of an active event are
    delivery-pipeline state, not plan state, so they are preserved across
    edits; on delete use :func:`remove_event_jobs` to drop everything.

    Jobs whose run time already passed (drained at startup and about to fire)
    are never removed: the fresh plan skips past run times by design, so
    removing them would lose a due reminder.
    """
    now = now or datetime.now(UTC)
    active = getattr(event, "status", EventStatus.ACTIVE) == EventStatus.ACTIVE
    desired = schedule_plan(event, now=now) if active else []
    existing = event_job_keys(scheduler, event.id, jobstore=jobstore)
    followups = {k: v for k, v in existing.items() if _is_followup_key(k)}
    base = {k: v for k, v in existing.items() if k not in followups}
    to_add, to_remove = plan_diff(base, desired)
    stale = [key for key in to_remove if base[key] > now]
    if not active:
        stale.extend(key for key in followups if followups[key] > now)
    for key in stale:
        # A one-shot job can fire between the event_job_keys() snapshot and
        # this removal (APScheduler deletes fired one-shots itself), so a
        # stale key may vanish mid-flight — tolerate JobLookupError exactly
        # like remove_event_jobs does (the reminder fired; nothing to drop).
        with contextlib.suppress(JobLookupError):
            scheduler.remove_job(key, jobstore=jobstore)
    added = 0
    for planned in to_add:
        key = dedupe_key(planned.event_id, planned.occurrence_id, planned.offset)
        if key in base and base[key] != planned.run_at:
            # Same reminder re-timed: remove the stale job so the dedupe
            # no-op in add_reminder_job doesn't keep the old run time.
            with contextlib.suppress(JobLookupError):
                scheduler.remove_job(key, jobstore=jobstore)
        if (
            add_reminder_job(scheduler, planned, job_func, now=now, jobstore=jobstore)
            is not None
        ):
            added += 1
    return added, len(stale)


def remove_event_jobs(
    scheduler: BackgroundScheduler,
    event_id: int,
    *,
    jobstore: str = "default",
) -> int:
    """Remove every pending job (plan + follow-ups) for one event.

    Returns the number of jobs removed; missing jobs (already fired) are
    tolerated so delete stays idempotent.
    """
    removed = 0
    for key in event_job_keys(scheduler, event_id, jobstore=jobstore):
        with contextlib.suppress(JobLookupError):
            scheduler.remove_job(key, jobstore=jobstore)
            removed += 1
    return removed
