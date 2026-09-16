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
