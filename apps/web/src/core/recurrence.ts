/**
 * Client-side recurrence expansion for the Timeline view.
 *
 * Pure business logic: expands an event's RFC 5545 `rrule` into concrete
 * occurrence timestamps (UTC ISO strings) over a bounded window starting at
 * the event's own start. The backend (`apps/api/app/recurrence.py`, via
 * `dateutil.rrule`) remains the source of truth for the Calendar (which reads
 * `GET /api/events/occurrences`); the Timeline works over raw events
 * (`GET /api/events`), so without expansion a recurrent event only ever
 * appears in its start month — e.g. a quarterly event starting 2026-01-01
 * never shows its 2026-10-01 occurrence in the Timeline.
 *
 * Supported shapes (everything the event wizard generates, plus common
 * custom variants): `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` with `INTERVAL`,
 * `COUNT`, `UNTIL`, weekly `BYDAY` lists, a single monthly `BYMONTHDAY`, a
 * yearly `BYMONTH` list, and single `BYHOUR`/`BYMINUTE` overrides. Anything
 * else (unknown frequencies, `BYSECOND`, multi-valued time overrides,
 * embedded `DTSTART`/`RDATE`/`EXDATE`, unparseable rules) falls back to the
 * single master occurrence so no event is ever dropped from the view.
 *
 * Semantics mirror `dateutil` (and therefore the backend):
 * - monthly/yearly candidates on a day the month lacks (e.g. the 31st in
 *   April, Feb 29 in a common year) are SKIPPED, not clamped — a quarterly
 *   rule from Jan 31 yields Jan/Jul/Oct, never April;
 * - occurrences keep the event's local wall-clock time in its own timezone
 *   (`tz`), converting to UTC through that zone (DST-aware);
 * - naive `start_at` values (how the API stores them) ARE the wall clock in
 *   `tz` and render verbatim; aware values are converted into `tz` first;
 * - `COUNT` limits emitted occurrences, `UNTIL` is an inclusive upper bound
 *   (basic `YYYYMMDDTHHMMSSZ` shapes are accepted; a naive UNTIL reads as a
 *   wall clock in the event's timezone, a bare date as its end of day).
 *
 * No React, no browser APIs beyond `Intl` (for zone offsets) and `Date` —
 * only data transformation over `EventRead` values.
 */

import type { EventRead } from "./eventTypes";
import {
  datePartsInTimezone,
  parseIso,
  parseNaiveWallClock,
} from "./dateFmt";

/** How far past an event's start occurrences are expanded (years).
 *
 * Eight years covers two leap-day cycles, so a Feb 29 yearly rule still
 * shows its upcoming occurrences instead of only its (possibly ancient)
 * start.
 */
export const EXPANSION_YEARS = 8;

/** Hard cap on occurrences produced per event.
 *
 * Bounds the Timeline rows a single recurrent event can generate (a daily
 * rule would otherwise flood the view with thousands of rows). The backend
 * scan bound is 1000 per month query; the Timeline keeps far fewer per
 * event so the list stays scannable while still covering years of
 * quarterly/monthly recurrences and two leap-day cycles.
 */
export const MAX_EXPANDED_OCCURRENCES = 60;

/** Safety bound on examined candidates per event (never loops forever). */
const MAX_CANDIDATES = 20000;

/** A wall-clock timestamp: calendar parts in the event's own timezone. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The parsed subset of an RFC 5545 rule this module understands. */
interface ParsedRrule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  /** Aware UNTIL as a UTC instant (inclusive upper bound), if any. */
  untilMs: number | null;
  /** Naive/date-only UNTIL (resolved against the event timezone later). */
  untilNaive: string | null;
  byday: number[] | null;
  bymonthday: number | null;
  bymonth: number[] | null;
  byhour: number | null;
  byminute: number | null;
}

/** Weekday number (0 = Sunday … 6 = Saturday) for an RFC 5545 BYDAY token. */
const BYDAY_NUMBERS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Compare two wall-clock dates (ignoring time): -1 | 0 | 1. */
function compareWallDate(
  a: Pick<WallClock, "year" | "month" | "day">,
  b: Pick<WallClock, "year" | "month" | "day">,
): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
}

/** Ordinal day number for wall-date arithmetic (UTC-based, DST-free). */
function wallOrdinal(day: Pick<WallClock, "year" | "month" | "day">): number {
  return Math.floor(Date.UTC(day.year, day.month - 1, day.day) / 86_400_000);
}

function wallFromOrdinal(ordinal: number): {
  year: number;
  month: number;
  day: number;
} {
  const d = new Date(ordinal * 86_400_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * Resolve a wall-clock time in `timeZone` to a UTC millisecond instant.
 *
 * Returns null when the zone is unknown/unsupported. Across a DST
 * spring-forward gap (a wall time that never exists) the result is shifted
 * forward by the gap so the occurrence still lands on the right date;
 * across a fall-back overlap one of the two instants is picked.
 */
export function wallToUtcMs(wall: WallClock, timeZone: string): number | null {
  let guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  for (let i = 0; i < 3; i += 1) {
    const parts = datePartsInTimezone(new Date(guess), timeZone);
    if (!parts) {
      return null;
    }
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
    );
    const wallMs = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    const next = guess + (wallMs - asUtc);
    if (next === guess) {
      break;
    }
    guess = next;
  }
  // Verify the resolved instant renders back to the intended wall time;
  // a mismatch means a DST gap — shift forward by the gap (bounded).
  const check = datePartsInTimezone(new Date(guess), timeZone);
  if (!check) {
    return null;
  }
  const wantMinutes = wall.hour * 60 + wall.minute;
  const gotMinutes = check.hour * 60 + check.minute;
  if (
    check.year === wall.year &&
    check.month === wall.month &&
    check.day === wall.day &&
    gotMinutes !== wantMinutes
  ) {
    const deltaMin = (wantMinutes - gotMinutes + 1440) % 1440;
    if (deltaMin > 0 && deltaMin <= 180) {
      guess += deltaMin * 60_000;
    }
  }
  return guess;
}

/** Format UTC milliseconds as `YYYY-MM-DDTHH:mm:ssZ` (matches the API). */
function toUtcIso(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Normalize an UNTIL value's basic ISO format (`YYYYMMDDTHHMMSSZ`) to the
 * extended form `Date` parses, and bare basic dates (`YYYYMMDD`) to
 * `YYYY-MM-DD`. Returns the normalized string, or null when it matches
 * neither a datetime nor a date shape.
 */
function normalizeUntil(raw: string): string | null {
  const basic = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}:?\d{2})?$/.exec(
    raw,
  );
  if (basic) {
    return `${basic[1]}-${basic[2]}-${basic[3]}T${basic[4]}:${basic[5]}:${basic[6]}${basic[7] ?? ""}`;
  }
  const basicDate = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (basicDate) {
    return `${basicDate[1]}-${basicDate[2]}-${basicDate[3]}`;
  }
  if (
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
      raw,
    )
  ) {
    return raw;
  }
  return null;
}

/** Whether an UNTIL string carries an explicit timezone/offset designator. */
function untilIsAware(normalized: string): boolean {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(normalized);
}

function parsePositiveInt(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Parse an RFC 5545 rule into the supported subset, or null when the rule
 * uses constructs this module does not expand (caller falls back to the
 * master occurrence).
 */
export function parseRrule(rrule: string): ParsedRrule | null {
  const normalized = rrule.trim().toUpperCase();
  if (
    normalized === "" ||
    normalized.includes("DTSTART") ||
    normalized.includes("RDATE") ||
    normalized.includes("EXDATE")
  ) {
    return null;
  }
  const parts = new Map<string, string>();
  for (const token of normalized.split(";")) {
    const eq = token.indexOf("=");
    if (eq <= 0) {
      return null;
    }
    parts.set(token.slice(0, eq).trim(), token.slice(eq + 1).trim());
  }
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    return null;
  }
  const intervalRaw = parts.get("INTERVAL");
  const interval = intervalRaw === undefined ? 1 : parsePositiveInt(intervalRaw);
  if (interval === null || interval < 1) {
    return null;
  }
  const countRaw = parts.get("COUNT");
  const count = countRaw === undefined ? null : parsePositiveInt(countRaw);
  if (countRaw !== undefined && (count === null || count < 1)) {
    return null;
  }
  let untilMs: number | null = null;
  let untilNaive: string | null = null;
  const untilRaw = parts.get("UNTIL");
  if (untilRaw !== undefined) {
    const normalized = normalizeUntil(untilRaw);
    if (normalized === null) {
      return null;
    }
    if (untilIsAware(normalized)) {
      const until = parseIso(normalized);
      if (!until) {
        return null;
      }
      untilMs = until.getTime();
    } else {
      untilNaive = normalized;
    }
  }
  let byday: number[] | null = null;
  const bydayRaw = parts.get("BYDAY");
  if (bydayRaw !== undefined) {
    byday = [];
    for (const token of bydayRaw.split(",")) {
      // Ordinal prefixes (e.g. 1MO) select month-nth weekdays — unsupported.
      if (!/^[A-Z]{2}$/.test(token) || !(token in BYDAY_NUMBERS)) {
        return null;
      }
      byday.push(BYDAY_NUMBERS[token]);
    }
    if (byday.length === 0) {
      return null;
    }
  }
  let bymonthday: number | null = null;
  const bymonthdayRaw = parts.get("BYMONTHDAY");
  if (bymonthdayRaw !== undefined) {
    // Negative (from-end) or multi-valued month days — unsupported.
    if (!/^\d+$/.test(bymonthdayRaw)) {
      return null;
    }
    bymonthday = Number(bymonthdayRaw);
    if (bymonthday < 1 || bymonthday > 31) {
      return null;
    }
  }
  let bymonth: number[] | null = null;
  const bymonthRaw = parts.get("BYMONTH");
  if (bymonthRaw !== undefined) {
    bymonth = [];
    for (const token of bymonthRaw.split(",")) {
      if (!/^\d+$/.test(token)) {
        return null;
      }
      const m = Number(token);
      if (m < 1 || m > 12) {
        return null;
      }
      bymonth.push(m);
    }
    if (bymonth.length === 0) {
      return null;
    }
  }
  // Intraday time selectors: only single hour/minute overrides are supported
  // (e.g. the check-in style `FREQ=DAILY;BYHOUR=15;BYMINUTE=0`); anything else
  // falls back to the master occurrence.
  let byhour: number | null = null;
  const byhourRaw = parts.get("BYHOUR");
  if (byhourRaw !== undefined) {
    if (!/^\d+$/.test(byhourRaw) || Number(byhourRaw) > 23) {
      return null;
    }
    byhour = Number(byhourRaw);
  }
  let byminute: number | null = null;
  const byminuteRaw = parts.get("BYMINUTE");
  if (byminuteRaw !== undefined) {
    if (!/^\d+$/.test(byminuteRaw) || Number(byminuteRaw) > 59) {
      return null;
    }
    byminute = Number(byminuteRaw);
  }
  const bysecondRaw = parts.get("BYSECOND");
  if (bysecondRaw !== undefined && bysecondRaw !== "0") {
    return null;
  }
  // BYYEARDAY / BYWEEKNO / BYSETPOS reshape the set in ways this module does
  // not replicate — fall back to the master occurrence.
  for (const key of ["BYYEARDAY", "BYWEEKNO", "BYSETPOS", "WKST"]) {
    if (key !== "WKST" && parts.has(key)) {
      return null;
    }
  }
  return {
    freq,
    interval,
    count,
    untilMs,
    untilNaive,
    byday,
    bymonthday,
    bymonth,
    byhour,
    byminute,
  };
}

/** The master wall clock an expansion starts from (null = unparseable). */
function masterWall(event: EventRead): WallClock | null {
  const naive = event.tz ? parseNaiveWallClock(event.start_at) : null;
  if (naive) {
    return {
      year: naive.year,
      month: naive.month,
      day: naive.day,
      hour: event.all_day ? 0 : naive.hour,
      minute: event.all_day ? 0 : naive.minute,
      second: 0,
    };
  }
  const parsed = parseIso(event.start_at);
  if (!parsed) {
    return null;
  }
  if (event.tz) {
    const parts = datePartsInTimezone(parsed, event.tz);
    if (!parts) {
      return null;
    }
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: event.all_day ? 0 : parts.hour,
      minute: event.all_day ? 0 : parts.minute,
      second: 0,
    };
  }
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
    hour: event.all_day ? 0 : parsed.getHours(),
    minute: event.all_day ? 0 : parsed.getMinutes(),
    second: 0,
  };
}

/** Apply single BYHOUR/BYMINUTE overrides to a wall clock, if present. */
function applyTimeOverrides(wall: WallClock, rule: ParsedRrule): WallClock {
  return {
    ...wall,
    hour: rule.byhour ?? wall.hour,
    minute: rule.byminute ?? wall.minute,
  };
}

/**
 * Expand an event into its occurrence UTC ISO timestamps.
 *
 * Returns the master start plus every recurrence falling after it, up to
 * `EXPANSION_YEARS` past the start (at most `MAX_EXPANDED_OCCURRENCES`
 * entries). One-time events, unparseable starts, unknown timezones and
 * unsupported rules yield exactly one entry: the master start (possibly the
 * raw value when it cannot be parsed — callers treat it as the single
 * occurrence, matching the previous Timeline behavior).
 */
export function expandOccurrences(event: EventRead): string[] {
  const wall = masterWall(event);
  if (!wall) {
    return [event.start_at];
  }
  const zone = event.tz || undefined;
  const toInstant = (w: WallClock): number | null => {
    if (!zone) {
      return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    }
    return wallToUtcMs(w, zone);
  };
  const startMs = toInstant(wall);
  if (startMs === null) {
    return [event.start_at];
  }
  if (!event.rrule) {
    return [toUtcIso(startMs)];
  }
  const rule = parseRrule(event.rrule);
  if (!rule) {
    return [toUtcIso(startMs)];
  }

  // Resolve a naive/date-only UNTIL as a wall clock in the event's timezone
  // (a bare date means the end of that day); an unresolvable UNTIL falls
  // back to the master occurrence rather than dropping the event.
  let untilMs = rule.untilMs;
  if (rule.untilNaive !== null) {
    const naiveWall = parseNaiveWallClock(rule.untilNaive);
    if (naiveWall) {
      const wall: WallClock = {
        ...naiveWall,
        second: 0,
      };
      untilMs = toInstant(wall);
    } else {
      const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rule.untilNaive.trim());
      if (!dateOnly) {
        return [toUtcIso(startMs)];
      }
      untilMs = toInstant({
        year: Number(dateOnly[1]),
        month: Number(dateOnly[2]),
        day: Number(dateOnly[3]),
        hour: 23,
        minute: 59,
        second: 59,
      });
    }
    if (untilMs === null) {
      return [toUtcIso(startMs)];
    }
  }

  const limitDate = { year: wall.year + EXPANSION_YEARS, month: wall.month, day: wall.day };
  const results: string[] = [];
  let emitted = 0;
  let examined = 0;

  const push = (w: WallClock): boolean => {
    examined += 1;
    if (examined > MAX_CANDIDATES) {
      return false;
    }
    if (compareWallDate(w, wall) < 0) {
      return true;
    }
    if (compareWallDate(w, limitDate) > 0) {
      return false;
    }
    const ms = toInstant(applyTimeOverrides(w, rule));
    if (ms === null) {
      return true;
    }
    if (ms < startMs) {
      return true;
    }
    if (untilMs !== null && ms > untilMs) {
      return false;
    }
    if (emitted >= MAX_EXPANDED_OCCURRENCES) {
      return false;
    }
    if (rule.count !== null && emitted >= rule.count) {
      return false;
    }
    results.push(toUtcIso(ms));
    emitted += 1;
    if (rule.count !== null && emitted >= rule.count) {
      return false;
    }
    return true;
  };

  const base: WallClock = { ...wall, second: 0 };
  if (rule.freq === "DAILY") {
    const startOrd = wallOrdinal(base);
    for (let k = 0; ; k += 1) {
      const parts = wallFromOrdinal(startOrd + k * rule.interval);
      const candidate: WallClock = {
        ...parts,
        hour: base.hour,
        minute: base.minute,
        second: 0,
      };
      if (compareWallDate(candidate, limitDate) > 0) {
        break;
      }
      if (!push(candidate)) {
        break;
      }
    }
  } else if (rule.freq === "WEEKLY") {
    const wanted = new Set(rule.byday ?? [weekdayOf(base.year, base.month, base.day)]);
    // Weeks are counted from the Monday of the start week (dateutil's
    // default WKST), so INTERVAL>1 rules align like the backend.
    const startOrd = wallOrdinal(base);
    const startWeekday = weekdayOf(base.year, base.month, base.day);
    const mondayOrd = startOrd - ((startWeekday + 6) % 7);
    for (let ord = startOrd; ; ord += 1) {
      const parts = wallFromOrdinal(ord);
      const candidate: WallClock = {
        ...parts,
        hour: base.hour,
        minute: base.minute,
        second: 0,
      };
      if (compareWallDate(candidate, limitDate) > 0) {
        break;
      }
      const weekIdx = Math.floor((ord - mondayOrd) / 7);
      const matches =
        wanted.has(weekdayOf(parts.year, parts.month, parts.day)) &&
        weekIdx % rule.interval === 0;
      if (matches) {
        if (!push(candidate)) {
          break;
        }
      } else {
        examined += 1;
        if (examined > MAX_CANDIDATES) {
          break;
        }
      }
    }
  } else if (rule.freq === "MONTHLY") {
    const day = rule.bymonthday ?? base.day;
    const startIdx = base.year * 12 + (base.month - 1);
    for (let k = 0; ; k += 1) {
      const idx = startIdx + k * rule.interval;
      const year = Math.floor(idx / 12);
      const month = (idx % 12) + 1;
      const candidate: WallClock = {
        year,
        month,
        day,
        hour: base.hour,
        minute: base.minute,
        second: 0,
      };
      if (compareWallDate(candidate, limitDate) > 0) {
        break;
      }
      // Months lacking the day are skipped (dateutil parity), not clamped.
      if (day > daysInMonth(year, month)) {
        examined += 1;
        if (examined > MAX_CANDIDATES) {
          break;
        }
        continue;
      }
      if (!push(candidate)) {
        break;
      }
    }
  } else {
    const months = [...(rule.bymonth ?? [base.month])].sort((a, b) => a - b);
    const day = rule.bymonthday ?? base.day;
    let stopped = false;
    for (let k = 0; !stopped; k += 1) {
      const year = base.year + k * rule.interval;
      if (year > limitDate.year) {
        break;
      }
      for (const month of months) {
        const candidate: WallClock = {
          year,
          month,
          day,
          hour: base.hour,
          minute: base.minute,
          second: 0,
        };
        if (compareWallDate(candidate, limitDate) > 0) {
          stopped = true;
          break;
        }
        if (day > daysInMonth(year, month)) {
          examined += 1;
          if (examined > MAX_CANDIDATES) {
            stopped = true;
            break;
          }
          continue;
        }
        if (!push(candidate)) {
          stopped = true;
          break;
        }
      }
    }
  }
  return results;
}
