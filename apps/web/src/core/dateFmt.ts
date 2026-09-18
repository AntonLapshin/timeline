/**
 * Date formatting helpers for the timeline web UI (issue #20).
 *
 * Pure business logic: converts between ISO strings and local `Date` values,
 * produces humanized relative labels ("in 3 weeks", "today", "yesterday"),
 * and month labels. Uses only ECMAScript `Date` — no browser APIs, no React.
 */

/** A month label such as "September 2026". */
export interface MonthLabel {
  /** Full label, e.g. "September 2026". */
  full: string;
  /** Short label, e.g. "Sep 2026". */
  short: string;
}

const MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Parse an ISO 8601 string into a local `Date`. Returns null if invalid. */
export function parseIso(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a local `Date` as a YYYY-MM-DD string (local calendar date). */
export function toLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Format a local `Date` as a full ISO 8601 timestamp (naive, local). */
export function toIsoLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Start of a calendar day for a given date (local midnight). */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The number of whole calendar days between two dates (a - b). */
export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86_400_000;
  return Math.round(
    (startOfDay(a).getTime() - startOfDay(b).getTime()) / msPerDay,
  );
}

/**
 * Humanize a date relative to "now".
 *
 * Returns "today", "yesterday", "tomorrow", "in N days", "N days ago",
 * "in N weeks", "N weeks ago", "in N months", "N months ago", "in N years",
 * or "N years ago".
 */
export function humanizeRelative(date: Date, now: Date): string {
  const diff = daysBetween(date, now);
  if (diff === 0) {
    return "today";
  }
  if (diff === 1) {
    return "tomorrow";
  }
  if (diff === -1) {
    return "yesterday";
  }
  const abs = Math.abs(diff);
  const prefix = diff > 0 ? "in" : "";
  const suffix = diff > 0 ? "" : "ago";
  if (abs < 7) {
    return [prefix, `${abs} days`, suffix].filter(Boolean).join(" ");
  }
  if (abs < 365) {
    const weeks = Math.round(abs / 7);
    const label = weeks === 1 ? "week" : "weeks";
    return [prefix, `${weeks} ${label}`, suffix].filter(Boolean).join(" ");
  }
  const years = Math.round(abs / 365);
  const label = years === 1 ? "year" : "years";
  return [prefix, `${years} ${label}`, suffix].filter(Boolean).join(" ");
}

/**
 * A short humanized relative label for an ISO start vs "now".
 *
 * Thin wrapper over `humanizeRelative` that accepts an ISO string and returns
 * null (rather than throwing) when it cannot be parsed, so callers can render
 * a relative badge like "today", "tomorrow", "in 3 weeks" or "2 days ago"
 * without branching on parse success themselves.
 */
export function relativeLabel(iso: string, now: Date): string | null {
  const date = parseIso(iso);
  if (!date) {
    return null;
  }
  return humanizeRelative(date, now);
}

/** Build full and short month labels for a YYYY-MM string. */
export function monthLabel(month: string): MonthLabel {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    return { full: month, short: month };
  }
  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  if (monthNum < 1 || monthNum > 12) {
    return { full: month, short: month };
  }
  const fullMonth = MONTHS_FULL[monthNum - 1];
  const shortMonth = MONTHS_SHORT[monthNum - 1];
  return { full: `${fullMonth} ${year}`, short: `${shortMonth} ${year}` };
}

/** A short weekday label for a date, e.g. "Mon". */
export function weekdayShort(date: Date): string {
  return DAYS_SHORT[date.getDay()];
}

/** A short weekday label for a calendar date (timezone-independent). */
export function weekdayForDate(year: number, month: number, day: number): string {
  return DAYS_SHORT[new Date(year, month - 1, day).getDay()];
}

/** A short month label for a month number (1-12), e.g. "Sep". */
export function monthShortForNumber(month: number): string {
  return MONTHS_SHORT[month - 1] ?? "";
}

/** Date/time parts of a Date in a given IANA timezone (fallback: null). */
export interface DatePartsInTimezone {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  monthShort: string;
}

/**
 * Split a Date into calendar parts in the given IANA timezone.
 *
 * Returns null when the timezone is invalid/unsupported so callers can fall
 * back to browser-local parts. All occurrence/event display must go through
 * here (with the occurrence's own `tz`) — formatting a UTC instant with
 * browser-local getters is what shifted "Next occurrences" into the wrong
 * timezone whenever the browser zone differed from the event zone.
 */
export function datePartsInTimezone(
  date: Date,
  timeZone: string,
): DatePartsInTimezone | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      weekday: "short",
    });
    const map = new Map(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    const monthFmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
    });
    const monthShort = monthFmt.format(date);
    const weekday = map.get("weekday") ?? "";
    const year = Number(map.get("year"));
    const month = Number(map.get("month"));
    const day = Number(map.get("day"));
    let hour = Number(map.get("hour"));
    const minute = Number(map.get("minute"));
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute)
    ) {
      return null;
    }
    // Some ICU builds return hour "24" for midnight with hour12:false.
    if (hour === 24) {
      hour = 0;
    }
    return { year, month, day, hour, minute, weekday, monthShort };
  } catch {
    return null;
  }
}

/** Format a Date as YYYY-MM-DD in the given IANA timezone (fallback: local). */
export function toDateInTimezone(date: Date, timeZone: string): string {
  const parts = datePartsInTimezone(date, timeZone);
  if (!parts) {
    return toLocalDate(date);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Format a Date as YYYY-MM in the given IANA timezone (fallback: local). */
export function toMonthInTimezone(date: Date, timeZone: string): string {
  return toDateInTimezone(date, timeZone).slice(0, 7);
}

/** A naive ISO timestamp split into wall-clock components. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const NAIVE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Split a naive ISO timestamp (no `Z`/offset designator) into wall-clock
 * components, or null when the value carries a timezone or is malformed.
 *
 * The API stores `start_at` as a naive local timestamp plus a separate IANA
 * `tz` (e.g. `2026-09-05T10:00:00` + `Europe/Berlin` meaning 10:00 in Berlin).
 * Such values ARE the wall clock in that zone: they must be rendered
 * verbatim, never round-tripped through the browser zone (a `new Date(naive)`
 * parses as browser-local, so converting it into the event zone shifts the
 * time by the zone difference — the "Next occurrences in a different
 * timezone" bug).
 */
export function parseNaiveWallClock(value: string): WallClock | null {
  const match = NAIVE_ISO_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/** Calendar parts ready for display, resolved for an event/occurrence zone. */
export interface DisplayParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  monthShort: string;
}

/**
 * Resolve the display parts for an ISO timestamp in the given zone.
 *
 * Naive timestamps with a zone render verbatim (wall clock in that zone);
 * aware timestamps are converted into the zone via `Intl`; without a zone (or
 * when the zone is invalid) the browser-local parts are used. `parsed` is the
 * `parseIso` result for the same value, used for every non-verbatim path.
 */
export function displayParts(
  iso: string,
  parsed: Date,
  timeZone?: string | null,
): DisplayParts {
  if (timeZone) {
    const naive = parseNaiveWallClock(iso);
    if (naive) {
      return {
        ...naive,
        weekday: weekdayForDate(naive.year, naive.month, naive.day),
        monthShort: monthShortForNumber(naive.month),
      };
    }
    const zoned = datePartsInTimezone(parsed, timeZone);
    if (zoned) {
      return zoned;
    }
  }
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
    hour: parsed.getHours(),
    minute: parsed.getMinutes(),
    weekday: weekdayShort(parsed),
    monthShort: parsed.toLocaleString("en-US", { month: "short" }),
  };
}

/** Format an ISO timestamp as YYYY-MM-DD in its zone (fallback: local). */
export function dateKeyForDisplay(
  iso: string,
  parsed: Date,
  timeZone?: string | null,
): string {
  const parts = displayParts(iso, parsed, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}
