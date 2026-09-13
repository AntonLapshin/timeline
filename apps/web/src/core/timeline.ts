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
import { parseIso, toLocalDate, weekdayShort } from "./dateFmt";

/** Display styling for a priority level. */
export interface PriorityStyle {
  /** Tailwind text/background color class for the priority. */
  color: string;
  /** A short glyph used as the priority icon. */
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
  /** The underlying event. */
  event: EventRead;
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
  /** Human time label for the event's start. */
  timeLabel: string;
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

/** Per-priority display styling (critical, medium, low). */
const PRIORITY_STYLES: Record<EventPriority, PriorityStyle> = {
  critical: { color: "text-red-700 bg-red-50 border-red-200", icon: "!" },
  medium: { color: "text-amber-700 bg-amber-50 border-amber-200", icon: "•" },
  low: { color: "text-slate-600 bg-slate-100 border-slate-200", icon: "·" },
};

/** Cycled tag color classes, indexed by a stable hash of the tag text. */
const TAG_COLORS = [
  "text-indigo-700 bg-indigo-50 border-indigo-200",
  "text-emerald-700 bg-emerald-50 border-emerald-200",
  "text-sky-700 bg-sky-50 border-sky-200",
  "text-fuchsia-700 bg-fuchsia-50 border-fuchsia-200",
  "text-teal-700 bg-teal-50 border-teal-200",
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
 */
export function toEventRow(event: EventRead): EventRow {
  const priority = priorityStyle(event.priority);
  const firstTag = event.tags.length > 0 ? event.tags[0] : null;
  const tag = firstTag ? tagStyle(firstTag) : null;
  const badge = formatRecurrence(event.rrule);
  return {
    event,
    priorityColor: priority.color,
    priorityIcon: priority.icon,
    tagColor: tag?.color ?? "text-slate-500 bg-transparent border-transparent",
    tagIcon: tag?.icon ?? "#",
    recurrenceBadge: badge.known ? badge.label : null,
    timeLabel: eventTimeLabel(event),
  };
}

/** Week number within a month (1..5) for a local date. */
export function weekInMonth(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

/**
 * Format an event's start for display, e.g. "Mon, Sep 5 · 10:00 AM".
 *
 * All-day events omit the time. Events with an unparseable start fall back to
 * the raw `start_at` string so the UI never renders a blank value.
 */
export function eventTimeLabel(event: EventRead): string {
  const parsed = parseIso(event.start_at);
  if (!parsed) {
    return event.start_at;
  }
  const weekday = weekdayShort(parsed);
  const monthShort = parsed.toLocaleString("en-US", { month: "short" });
  const day = parsed.getDate();
  if (event.all_day) {
    return `${weekday}, ${monthShort} ${day}`;
  }
  const hour = parsed.getHours();
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${weekday}, ${monthShort} ${day} · ${hour12}:${minute} ${period}`;
}

/**
 * Group events into month buckets, each with week buckets, sorted
 * chronologically by start time.
 *
 * Events with an unparseable `start_at` are placed in a trailing "Unsorted"
 * bucket so no event is ever dropped from the view.
 */
export function groupByMonth(events: readonly EventRead[]): MonthGroup[] {
  const sorted = [...events].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const months = new Map<string, MonthGroup>();
  const unsortedRows: EventRow[] = [];

  for (const event of sorted) {
    const row = toEventRow(event);
    const parsed = parseIso(event.start_at);
    if (!parsed) {
      unsortedRows.push(row);
      continue;
    }
    const monthKey = toLocalDate(parsed).slice(0, 7);
    let month = months.get(monthKey);
    if (!month) {
      month = { key: monthKey, label: monthKey, weeks: [] };
      months.set(monthKey, month);
    }
    const weekNum = weekInMonth(parsed);
    const weekKey = `${monthKey}:${weekNum}`;
    let week = month.weeks.find((w) => w.key === weekKey);
    if (!week) {
      week = { key: weekKey, label: `Week ${weekNum}`, rows: [] };
      month.weeks.push(week);
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
