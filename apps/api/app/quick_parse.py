"""Deterministic offline event parsing for Telegram ``/add`` / ``/quick``.

A robust, LLM-free alternative to :mod:`app.llm_parse` for the common case:
the owner types a short event line and the bot must produce a draft card
instantly (no network, no key, no waiting). The same
Save / Edit / Discard confirmation flow applies — the draft card is the
owner's chance to catch a mis-parse before tapping **Save**.

Syntax (case-insensitive, tokens may appear in any order)::

    /add Pick up daughter from school on Friday at 18:00 1h low weekly
    /quick A new season of Silo arrives on June 12 2027

Extracted tokens (removed from the title):

- **date** — ``today`` | ``tomorrow`` | ``day after tomorrow`` |
  ``on Friday`` / ``Friday`` / ``next Friday`` (always the *next* occurrence:
  saying ``Friday`` on a Friday means 7 days out) |
  ``June 12`` / ``June 12 2027`` / ``12 June 2027`` |
  ``2027-06-12`` | ``12.06.2027`` | ``in 3 days`` / ``in 2 weeks``.
  Default: today.
- **time** — ``18:00`` / ``6pm`` / ``6:30 pm``, with or without ``at``;
  a bare hour needs ``at`` (``at 18``). Default: none (all-day event).
- **reminders** — ``15m`` / ``1h`` / ``2d`` (also ``15 min``, ``1 hour``,
  ``2 days`` …; ``1w`` becomes ``7d`` so the shared-schema pattern
  ``^[0-9]+[dhm]$`` always holds). Default: ``["1d"]``.
- **priority** — ``critical`` (aliases ``high``, ``urgent``) |
  ``medium`` (alias ``normal``) | ``low``. Default: ``medium``.
- **recurrence** — ``daily`` / ``weekly`` / ``monthly`` / ``quarterly``
  (every 3 months) / ``yearly`` (aliases ``annual``, ``annually``,
  ``every day`` …). Default: one-time (no ``rrule``).

Everything left after the extracted tokens is stripped is the **title**.

The main entry point is :func:`parse_quick_add` (pure: no I/O). It returns
a :class:`QuickParseResult` wrapping a validated ``ParsedDraft`` plus
``has_explicit_date`` / ``has_explicit_time`` flags so the caller can decide
whether the deterministic result is confident enough (``/add`` uses it when
an explicit date or time was found and falls back to the LLM otherwise;
``/quick`` always uses it).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .llm_parse import ParsedDraft

#: Default reminder when the text names none (1 day before, via Telegram).
DEFAULT_REMINDER_OFFSETS: list[str] = ["1d"]

#: Default priority when the text names none.
DEFAULT_PRIORITY = "medium"

#: Default channel (Telegram DM that created the event).
DEFAULT_CHANNELS: list[str] = ["telegram"]

_MONTHS = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}

_WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_MONTH_NAMES = (
    "january|jan|february|feb|march|mar|april|apr|may|june|jun|"
    "july|jul|august|aug|september|sep|sept|october|oct|november|nov|"
    "december|dec"
)
_WEEKDAY_NAMES = "monday|tuesday|wednesday|thursday|friday|saturday|sunday"

# Date patterns (all case-insensitive).
_ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_MONTH_FIRST_RE = re.compile(
    rf"\b(?:on\s+|for\s+)?({_MONTH_NAMES})\s+(\d{{1,2}})"
    r"(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?",
    re.IGNORECASE,
)
_DAY_FIRST_RE = re.compile(
    rf"\b(?:on\s+|for\s+)?(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({_MONTH_NAMES})"
    r"(?:\s*,?\s*(\d{4}))?",
    re.IGNORECASE,
)
_NUMERIC_DATE_RE = re.compile(r"\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b")
_WEEKDAY_RE = re.compile(
    rf"\b(?:on\s+|next\s+|this\s+)?({_WEEKDAY_NAMES})\b", re.IGNORECASE
)
_RELATIVE_RE = re.compile(
    r"\b(day\s+after\s+tomorrow|today|tonight|tomorrow)\b", re.IGNORECASE
)
_IN_N_RE = re.compile(r"\bin\s+(\d+)\s*(days?|weeks?|d|w)\b", re.IGNORECASE)

# Time patterns. HH:MM works with or without "at"; a bare hour needs "at"
# so a month-day like "June 12" is never eaten as a time.
_HHMM_RE = re.compile(
    r"\b(?:at\s+)?(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\.?)?", re.IGNORECASE
)
_H_AMPM_RE = re.compile(r"\b(?:at\s+)?(\d{1,2})\s*([ap])\.?\s*m\.?", re.IGNORECASE)
# "at 18h" is a time; a bare "18h" is a reminder ("1h/2d/15m are reminders").
_AT_H_HOUR_RE = re.compile(r"\bat\s+(\d{1,2})\s*h\b", re.IGNORECASE)
_AT_HOUR_RE = re.compile(r"\bat\s+(\d{1,2})(?!\s*[:/.\-0-9])", re.IGNORECASE)

_REMINDER_RE = re.compile(
    r"\b(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|"
    r"d|day|days|w|week|weeks)\b",
    re.IGNORECASE,
)

_PRIORITY_RE = re.compile(
    r"\b(critical|high|urgent|medium|normal|low)\b", re.IGNORECASE
)
_PRIORITY_MAP = {
    "critical": "critical",
    "high": "critical",
    "urgent": "critical",
    "medium": "medium",
    "normal": "medium",
    "low": "low",
}

_RECURRENCE_RE = re.compile(
    r"\b(every\s+day|every\s+week|every\s+month|every\s+quarter|every\s+year|"
    r"everyday|daily|weekly|monthly|quarterly|yearly|annual|annually)\b",
    re.IGNORECASE,
)
_RECURRENCE_MAP = {
    "everyday": "FREQ=DAILY",
    "every day": "FREQ=DAILY",
    "daily": "FREQ=DAILY",
    "every week": "FREQ=WEEKLY",
    "weekly": "FREQ=WEEKLY",
    "every month": "FREQ=MONTHLY",
    "monthly": "FREQ=MONTHLY",
    "every quarter": "FREQ=MONTHLY;INTERVAL=3",
    "quarterly": "FREQ=MONTHLY;INTERVAL=3",
    "every year": "FREQ=YEARLY",
    "yearly": "FREQ=YEARLY",
    "annual": "FREQ=YEARLY",
    "annually": "FREQ=YEARLY",
}


@dataclass(frozen=True)
class QuickParseResult:
    """The outcome of :func:`parse_quick_add` (pure value object)."""

    draft: ParsedDraft
    #: True when the text named an explicit date (calendar date, weekday,
    #: relative day or ``in N days/weeks``). False means "today by default".
    has_explicit_date: bool
    #: True when the text named an explicit time.
    has_explicit_time: bool


def _zone_or_utc(tz: str) -> ZoneInfo | timezone:
    try:
        return ZoneInfo(tz) if tz else UTC
    except (ValueError, ZoneInfoNotFoundError):
        return UTC


def _expand_year(year: int | None) -> int | None:
    if year is None:
        return None
    if year < 100:  # two-digit year: 27 -> 2027, 99 -> 1999 (within ±50).
        return 2000 + year if year < 70 else 1900 + year
    return year


def _safe_date(
    year: int, month: int, day: int, *, today: datetime
) -> tuple[int, int, int]:
    """Clamp an out-of-range day (e.g. Feb 30) to the month's last day."""
    import calendar as _cal

    last = _cal.monthrange(year, month)[1]
    return year, month, min(day, last)


def _resolve_yearless(month: int, day: int, today: datetime) -> tuple[int, int, int]:
    """Resolve a year-less month/day to the next upcoming occurrence."""
    year = today.year
    try:
        candidate = today.replace(year=year, month=month, day=day)
    except ValueError:
        year, month, day = _safe_date(year, month, day, today=today)
        candidate = today.replace(year=year, month=month, day=day)
    if candidate.date() < today.date():
        year += 1
    year, month, day = _safe_date(year, month, day, today=today)
    return year, month, day


@dataclass
class _DateHit:
    start: int
    end: int
    year: int | None
    month: int | None
    day: int | None
    weekday: int | None = None
    delta_days: int | None = None


def _find_date(text: str) -> _DateHit | None:
    """Find the earliest explicit date mention in ``text`` (or None)."""
    candidates: list[_DateHit] = []

    for m in _ISO_DATE_RE.finditer(text):
        try:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            datetime(y, mo, d)
        except ValueError:
            continue
        candidates.append(_DateHit(m.start(), m.end(), y, mo, d))

    for m in _MONTH_FIRST_RE.finditer(text):
        month = _MONTHS[m.group(1).lower()]
        day = int(m.group(2))
        if not 1 <= day <= 31:
            continue
        raw_year = m.group(3)
        candidates.append(
            _DateHit(
                m.start(),
                m.end(),
                _expand_year(int(raw_year)) if raw_year else None,
                month,
                day,
            )
        )

    for m in _DAY_FIRST_RE.finditer(text):
        day = int(m.group(1))
        if not 1 <= day <= 31:
            continue
        month = _MONTHS[m.group(2).lower()]
        raw_year = m.group(3)
        candidates.append(
            _DateHit(
                m.start(),
                m.end(),
                _expand_year(int(raw_year)) if raw_year else None,
                month,
                day,
            )
        )

    for m in _NUMERIC_DATE_RE.finditer(text):
        # Skip ISO leftovers (YYYY-MM-DD already handled): a digit directly
        # before the match means we are inside a longer number/date.
        if re.search(r"\d$", text[: m.start()]):
            continue
        first, second = int(m.group(1)), int(m.group(2))
        raw_year = m.group(3)
        if raw_year is not None:
            # DD.MM.YYYY (European first — matches the 24h-clock audience).
            year = _expand_year(int(raw_year))
            if not (1 <= first <= 31 and 1 <= second <= 12):
                continue
            candidates.append(_DateHit(m.start(), m.end(), year, second, first))
        else:
            if not (1 <= first <= 31 and 1 <= second <= 12):
                continue
            candidates.append(_DateHit(m.start(), m.end(), None, second, first))

    for m in _WEEKDAY_RE.finditer(text):
        # "May" is both a month and (rarely) a name — the month regex above
        # already claimed month uses; here only true weekday tokens match.
        candidates.append(
            _DateHit(
                m.start(),
                m.end(),
                None,
                None,
                None,
                weekday=_WEEKDAYS[m.group(1).lower()],
            )
        )

    for m in _RELATIVE_RE.finditer(text):
        word = re.sub(r"\s+", " ", m.group(1).lower())
        delta = {"today": 0, "tonight": 0, "tomorrow": 1, "day after tomorrow": 2}[word]
        candidates.append(
            _DateHit(m.start(), m.end(), None, None, None, delta_days=delta)
        )

    for m in _IN_N_RE.finditer(text):
        amount = int(m.group(1))
        unit = m.group(2).lower()
        delta = amount * 7 if unit.startswith("w") else amount
        candidates.append(
            _DateHit(m.start(), m.end(), None, None, None, delta_days=delta)
        )

    if not candidates:
        return None
    # Earliest mention in the string wins (natural reading order).
    candidates.sort(key=lambda c: (c.start, c.end))
    return candidates[0]


@dataclass
class _TimeHit:
    start: int
    end: int
    hour: int
    minute: int


def _find_time(text: str) -> _TimeHit | None:
    """Find the first explicit time mention in ``text`` (or None).

    Stages run in order with early return so a longer, more specific match
    (``at 9am``) is never beaten by a shorter overlapping one (``at 9``).
    """
    candidates: list[_TimeHit] = []
    for m in _HHMM_RE.finditer(text):
        hour, minute = int(m.group(1)), int(m.group(2))
        meridiem = (m.group(3) or "").lower()
        if meridiem in ("a", "p"):
            if not 1 <= hour <= 12 or minute > 59:
                continue
            hour = hour % 12 + (12 if meridiem == "p" else 0)
        elif hour > 23 or minute > 59:
            continue
        candidates.append(_TimeHit(m.start(), m.end(), hour, minute))
    if candidates:
        candidates.sort(key=lambda c: (c.start, c.end))
        return candidates[0]
    for m in _H_AMPM_RE.finditer(text):
        hour = int(m.group(1))
        if not 1 <= hour <= 12:
            continue
        hour = hour % 12 + (12 if m.group(2).lower() == "p" else 0)
        candidates.append(_TimeHit(m.start(), m.end(), hour, 0))
    if candidates:
        candidates.sort(key=lambda c: (c.start, c.end))
        return candidates[0]
    for m in _AT_H_HOUR_RE.finditer(text):
        hour = int(m.group(1))
        if hour > 23:
            continue
        candidates.append(_TimeHit(m.start(), m.end(), hour, 0))
    if candidates:
        candidates.sort(key=lambda c: (c.start, c.end))
        return candidates[0]
    for m in _AT_HOUR_RE.finditer(text):
        hour = int(m.group(1))
        if hour > 23:
            continue
        # "at 12" is unambiguously a time because of the "at" (a month-day
        # like "June 12" never carries one).
        candidates.append(_TimeHit(m.start(), m.end(), hour, 0))
    if not candidates:
        return None
    candidates.sort(key=lambda c: (c.start, c.end))
    return candidates[0]


def _normalize_reminder(amount: int, unit: str) -> str | None:
    if amount <= 0:
        return None
    unit = unit.lower()
    if unit.startswith("m"):
        return f"{amount}m"
    if unit.startswith("h"):
        return f"{amount}h"
    if unit.startswith("d"):
        return f"{amount}d"
    if unit.startswith("w"):
        return f"{amount * 7}d"  # shared schema has no "w" suffix
    return None


def _blank_spans(text: str, spans: list[tuple[int, int]]) -> str:
    """Replace ``spans`` with spaces (keeps indices stable for later stages)."""
    chars = list(text)
    for start, end in spans:
        for i in range(max(0, start), min(len(chars), max(0, end))):
            chars[i] = " "
    return "".join(chars)


def parse_quick_add(text: str, now: datetime, tz: str = "UTC") -> QuickParseResult:
    """Deterministically parse ``text`` into an event draft (pure).

    ``now`` is the reference instant (aware preferred; naive reads as UTC)
    and ``tz`` the owner's IANA zone used for the wall clock. Never raises
    for ordinary text — the worst case is a today/all-day draft titled with
    the raw input.
    """
    raw = (text or "").strip()
    zone = _zone_or_utc(tz or "UTC")
    zone_label = tz or "UTC"
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    local_now = now.astimezone(zone)

    # --- date & time first: later stages search the remainder so a token is
    # never claimed twice ("at 18h" is a time, not an "18h" reminder; the
    # "3 days" in "in 3 days" is a date, not a reminder). ---
    date_hit = _find_date(raw)
    time_scope = _blank_spans(raw, [(date_hit.start, date_hit.end)] if date_hit else [])
    time_hit = _find_time(time_scope)
    date_span = (date_hit.start, date_hit.end) if date_hit else None
    time_span = (time_hit.start, time_hit.end) if time_hit else None

    # --- reminders (all mentions outside the date/time spans) ---
    reminder_scope = _blank_spans(
        raw, [s for s in (date_span, time_span) if s is not None]
    )
    reminders: list[str] = []
    reminder_spans: list[tuple[int, int]] = []
    for m in _REMINDER_RE.finditer(reminder_scope):
        normalized = _normalize_reminder(int(m.group(1)), m.group(2))
        if normalized is not None and normalized not in reminders:
            reminders.append(normalized)
            reminder_spans.append((m.start(), m.end()))

    # --- priority (last mention wins) ---
    priority = DEFAULT_PRIORITY
    priority_spans: list[tuple[int, int]] = []
    for m in _PRIORITY_RE.finditer(raw):
        priority = _PRIORITY_MAP[m.group(1).lower()]
        priority_spans.append((m.start(), m.end()))

    # --- recurrence (first mention wins) ---
    rrule: str | None = None
    recurrence_spans: list[tuple[int, int]] = []
    rec_match = _RECURRENCE_RE.search(raw)
    if rec_match:
        rrule = _RECURRENCE_MAP[rec_match.group(1).lower().strip()]
        recurrence_spans.append((rec_match.start(), rec_match.end()))

    if date_hit is None:
        event_date = local_now.date()
        has_explicit_date = False
    elif date_hit.delta_days is not None:
        event_date = (local_now + timedelta(days=date_hit.delta_days)).date()
        has_explicit_date = True
    elif date_hit.weekday is not None:
        days_ahead = (date_hit.weekday - local_now.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7  # "Friday" on a Friday => next Friday
        event_date = (local_now + timedelta(days=days_ahead)).date()
        has_explicit_date = True
    else:
        assert date_hit.month is not None and date_hit.day is not None
        if date_hit.year is not None:
            y, mo, d = _safe_date(
                date_hit.year,
                date_hit.month,
                date_hit.day,
                today=local_now,
            )
            event_date = datetime(y, mo, d).date()
        else:
            y, mo, d = _resolve_yearless(date_hit.month, date_hit.day, local_now)
            event_date = datetime(y, mo, d).date()
        has_explicit_date = True

    has_explicit_time = time_hit is not None
    if time_hit is not None:
        local_start = datetime(
            event_date.year,
            event_date.month,
            event_date.day,
            time_hit.hour,
            time_hit.minute,
        ).replace(tzinfo=zone)
        all_day = False
    else:
        local_start = datetime(
            event_date.year, event_date.month, event_date.day
        ).replace(tzinfo=zone)
        all_day = True

    # --- title: whatever is left after removing the extracted spans ---
    spans = [
        s
        for s in (
            date_span,
            time_span,
            *reminder_spans,
            *priority_spans,
            *recurrence_spans,
        )
        if s is not None
    ]
    title = _strip_spans(raw, spans)
    if not title:
        title = raw  # e.g. input was only "Friday 18:00"

    draft = ParsedDraft(
        title=title,
        start_at=local_start.isoformat(),
        all_day=all_day,
        tz=zone_label,
        rrule=rrule,
        priority=priority,
        type="recurrent" if rrule else "one_time",
        channels=list(DEFAULT_CHANNELS),
        reminder_offsets=reminders or list(DEFAULT_REMINDER_OFFSETS),
        tags=[],
    )
    return QuickParseResult(
        draft=draft,
        has_explicit_date=has_explicit_date,
        has_explicit_time=has_explicit_time,
    )


def _strip_spans(text: str, spans: list[tuple[int, int]]) -> str:
    """Remove ``spans`` from ``text`` and tidy the leftover into a title."""
    if not spans:
        cleaned = text
    else:
        parts: list[str] = []
        cursor = 0
        for start, end in sorted(spans):
            if start < cursor:  # overlapping span — already removed
                continue
            parts.append(text[cursor:start])
            cursor = max(cursor, end)
        parts.append(text[cursor:])
        cleaned = " ".join(parts)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    # Drop dangling prepositions/punctuation left behind by span removal:
    # "Silo arrives on" -> "Silo arrives", "school at" -> "school".
    cleaned = re.sub(r"^(?:on|at|for|by|in)\b\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\s*\b(on|at|for|by|in|and)\s*$", "", cleaned, flags=re.IGNORECASE
    )
    cleaned = re.sub(r"[\s,;:\-]+$", "", cleaned).strip()
    cleaned = re.sub(r"^[\s,;:\-]+", "", cleaned).strip()
    return cleaned
