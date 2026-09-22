/**
 * Timeline view derivation (issue #21).
 *
 * Pure business logic for the primary Timeline view: groups events by month
 * (and week within month), sorts them chronologically, derives per-row display
 * styling (priority color + icon, tag color + icon) and a recurrence badge,
 * and provides the "load more" pagination slicing used by the infinite-scroll
 * list. No React, no Tailwind imports, no browser APIs — only data
 * transformation over `EventRead` values.
 */

import type { EventPriority, EventRead } from "./eventTypes";
import { formatRecurrence } from "./recurrenceFormat";
import { expandOccurrences } from "./recurrence";
import {
  displayParts,
  parseIso,
  relativeLabel,
} from "./dateFmt";

/** Display styling for a priority level. */
export interface PriorityStyle {
  /** Tailwind gradient-chip class for the priority. */
  color: string;
  /** Unused glyph slot (kept for API compat) — priorities render as
   *  gradient dots via `PriorityDot`, so this is always "". */
  icon: string;
}

/** Display styling for a tag. */
export interface TagStyle {
  /** Tailwind color class for the tag. */
  color: string;
  /** A short glyph used as the tag icon. */
  icon: string;
}

/** A fully derived row for a single event in the timeline. */
export interface EventRow {
  /** The underlying event (always the master event, even for a recurrence). */
  event: EventRead;
  /** ISO start of this row's occurrence (the master start for one-time rows). */
  startIso: string;
  /** Derived priority color class. */
  priorityColor: string;
  /** Derived priority icon glyph. */
  priorityIcon: string;
  /** Derived tag color class. */
  tagColor: string;
  /** Derived tag icon glyph. */
  tagIcon: string;
  /** Human recurrence badge, or null for a one-time event. */
  recurrenceBadge: string | null;
  /** Human time label for the row's occurrence start. */
  timeLabel: string;
  /** Humanized relative label vs now, e.g. "today", "in 3 weeks". */
  relativeLabel: string | null;
}

/** A week bucket within a month (week 1..5 by calendar day). */
export interface WeekGroup {
  /** Stable key, e.g. "2026-09:1". */
  key: string;
  /** Human label, e.g. "Week 1". */
  label: string;
  /** Rows in this week, sorted chronologically. */
  rows: EventRow[];
}

/** A month bucket of the timeline. */
export interface MonthGroup {
  /** Stable key, e.g. "2026-09". */
  key: string;
  /** Human label, e.g. "September 2026". */
  label: string;
  /** Weeks within the month, in order. */
  weeks: WeekGroup[];
}

/** Per-priority display styling (critical, medium, low).
 *
 * `color` is a full Tailwind gradient-chip class: white text on a saturated
 * gradient in light mode with a softened gradient + tinted ring in dark mode.
 * Rendered as a gradient dot via `PriorityDot` (no glyph needed, so `icon`
 * is empty) and reused for chips/pills (week chips, summary counts).
 */
const PRIORITY_STYLES: Record<EventPriority, PriorityStyle> = {
  critical: {
    color:
      "border-red-600/40 bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-sm shadow-red-500/30 dark:border-red-400/30 dark:from-rose-500/90 dark:to-red-600/90",
    icon: "",
  },
  medium: {
    color:
      "border-amber-500/40 bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm shadow-amber-500/30 dark:border-amber-400/30 dark:from-amber-400/90 dark:to-orange-500/90",
    icon: "",
  },
  low: {
    color:
      "border-sky-500/30 bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-sm shadow-sky-500/25 dark:border-sky-400/30 dark:from-sky-400/90 dark:to-indigo-500/90",
    icon: "",
  },
};

/** Cycled tag color classes, indexed by a stable hash of the tag text.
 *
 * Muted pastel chips in light mode; desaturated translucent tints in dark
 * mode (no near-white backgrounds).
 */
const TAG_COLORS = [
  "border-indigo-200 bg-indigo-50/80 text-indigo-700 dark:border-indigo-400/20 dark:bg-indigo-400/10 dark:text-indigo-300",
  "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  "border-sky-200 bg-sky-50/80 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300",
  "border-fuchsia-200 bg-fuchsia-50/80 text-fuchsia-700 dark:border-fuchsia-400/20 dark:bg-fuchsia-400/10 dark:text-fuchsia-300",
  "border-teal-200 bg-teal-50/80 text-teal-700 dark:border-teal-400/20 dark:bg-teal-400/10 dark:text-teal-300",
];

/** A stable (non-negative) hash of a string. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Derive display styling for a priority level. */
export function priorityStyle(priority: EventPriority): PriorityStyle {
  return PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium;
}

/** Derive display styling for a tag (color cycles deterministically). */
export function tagStyle(tag: string): TagStyle {
  const color = TAG_COLORS[hashString(tag) % TAG_COLORS.length];
  return { color, icon: "#" };
}

/**
 * Derive the display row for an event.
 *
 * The recurrence badge is built from the event's `rrule` via
 * `formatRecurrence`; a one-time event (no recurrence) yields `null`.
 * `startIso` selects which occurrence the row renders (defaults to the
 * master start); `event` always stays the master event so edits and the
 * drawer keep working on the real record.
 */
export function toEventRow(event: EventRead, startIso?: string): EventRow {
  const priority = priorityStyle(event.priority);
  const firstTag = event.tags.length > 0 ? event.tags[0] : null;
  const tag = firstTag ? tagStyle(firstTag) : null;
  const badge = formatRecurrence(event.rrule);
  const iso = startIso ?? event.start_at;
  return {
    event,
    startIso: iso,
    priorityColor: priority.color,
    priorityIcon: priority.icon,
    tagColor: tag?.color ?? "border-slate-200 bg-slate-100/60 text-slate-500 dark:border-slate-600/60 dark:bg-slate-700/40 dark:text-slate-400",
    tagIcon: tag?.icon ?? "#",
    recurrenceBadge: badge.known ? badge.label : null,
    timeLabel: eventTimeLabel(event, iso),
    relativeLabel: relativeLabel(iso, new Date()),
  };
}

/** Week number within a month (1..5) for a local date. */
export function weekInMonth(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

/**
 * Format an event's start for display, e.g. "Mon, Sep 5 · 10:00 AM".
 *
 * Rendered in the event's own timezone (`event.tz`), not the browser zone —
 * a UTC instant formatted with browser-local getters shifts the wall-clock
 * time whenever the two zones differ. All-day events omit the time. Events
 * with an unparseable start fall back to the raw `start_at` string so the UI
 * never renders a blank value. `startIso` selects which occurrence to label
 * (defaults to the master start).
 */
export function eventTimeLabel(event: EventRead, startIso?: string): string {
  const iso = startIso ?? event.start_at;
  const parsed = parseIso(iso);
  if (!parsed) {
    return event.start_at;
  }
  const parts = displayParts(iso, parsed, event.tz || undefined);
  if (event.all_day) {
    return `${parts.weekday}, ${parts.monthShort} ${parts.day}`;
  }
  const period = parts.hour >= 12 ? "PM" : "AM";
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${parts.weekday}, ${parts.monthShort} ${parts.day} · ${hour12}:${String(parts.minute).padStart(2, "0")} ${period}`;
}

/**
 * Group events into month buckets, each with week buckets, sorted
 * chronologically by occurrence start time.
 *
 * Recurrent events contribute one row per occurrence (expanded via
 * `expandOccurrences`, mirroring the backend recurrence engine), so a
 * quarterly event starting in January also appears under October —
 * previously it only ever showed in its start month. One-time events and
 * unsupported rules contribute their single master row, exactly as before.
 * The row keeps the master `event` (edits/drawer keep working on the real
 * record) while its labels reflect the occurrence start.
 *
 * Events with an unparseable `start_at` are placed in a trailing "Unsorted"
 * bucket so no event is ever dropped from the view.
 */
export function groupByMonth(events: readonly EventRead[]): MonthGroup[] {
  const pairs: Array<{ event: EventRead; startIso: string }> = [];
  for (const event of events) {
    for (const startIso of expandOccurrences(event)) {
      pairs.push({ event, startIso });
    }
  }
  pairs.sort((a, b) => a.startIso.localeCompare(b.startIso));
  const months = new Map<string, MonthGroup>();
  const unsortedRows: EventRow[] = [];

  for (const { event, startIso } of pairs) {
    const row = toEventRow(event, startIso);
    const parsed = parseIso(startIso);
    if (!parsed) {
      unsortedRows.push(row);
      continue;
    }
    // Month AND week both come from the occurrence date in the event's own
    // timezone (not browser-local getters, which shift the placement
    // whenever the zones differ).
    const parts = displayParts(startIso, parsed, event.tz || undefined);
    const pad = (n: number) => String(n).padStart(2, "0");
    const month = `${parts.year}-${pad(parts.month)}`;
    let monthGroup = months.get(month);
    if (!monthGroup) {
      monthGroup = { key: month, label: month, weeks: [] };
      months.set(month, monthGroup);
    }
    const weekNum = Math.floor((parts.day - 1) / 7) + 1;
    const weekKey = `${month}:${weekNum}`;
    let week = monthGroup.weeks.find((w) => w.key === weekKey);
    if (!week) {
      week = { key: weekKey, label: `Week ${weekNum}`, rows: [] };
      monthGroup.weeks.push(week);
    }
    week.rows.push(row);
  }

  const groups = [...months.values()];
  if (unsortedRows.length > 0) {
    groups.push({
      key: "unsorted",
      label: "Unsorted",
      weeks: [{ key: "unsorted:1", label: "Week 1", rows: unsortedRows }],
    });
  }
  return groups;
}

/**
 * Slice a chronologically sorted event list for "load more" pagination.
 *
 * Returns a **cumulative** slice — everything revealed so far, i.e.
 * `[0, (page + 1) * pageSize)`. This is the infinite-scroll contract the
 * Timeline view relies on: clicking "Load more" appends the next page to the
 * previously visible events instead of replacing them.
 */
export function paginate(
  events: readonly EventRead[],
  pageSize: number,
  page: number,
): EventRead[] {
  const size = Math.max(1, Math.floor(pageSize));
  const end = (Math.max(0, Math.floor(page)) + 1) * size;
  return events.slice(0, end);
}

/** Whether more events remain beyond the given page. */
export function hasMore(
  events: readonly EventRead[],
  pageSize: number,
  page: number,
): boolean {
  const size = Math.max(1, Math.floor(pageSize));
  const start = Math.max(0, Math.floor(page)) * size;
  return start + size < events.length;
}
