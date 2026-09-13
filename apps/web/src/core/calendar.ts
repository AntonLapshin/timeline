/**
 * Calendar view derivation (issue #28).
 *
 * Pure business logic for the Calendar view's month grid and day drawer:
 * builds a weeks×days month grid, filters a day's occurrences from the
 * per-occurrence payload (`GET /api/events/occurrences`), derives each day's
 * event count/dots, and provides month label / navigation helpers. No React,
 * no Tailwind imports, no browser APIs — only data transformation over
 * `EventOccurrence` values.
 */

import type { EventOccurrence } from "./eventTypes";
import { parseIso, toLocalDate, weekdayShort } from "./dateFmt";
import { formatRecurrence } from "./recurrenceFormat";
import { priorityStyle, tagStyle } from "./timeline";

/** A single day cell in the month grid. */
export interface CalendarDay {
  /** The calendar date (local midnight). */
  date: Date;
  /** Local calendar date as YYYY-MM-DD. */
  isoDate: string;
  /** Day-of-month number (1-31). */
  dayOfMonth: number;
  /** Whether this day belongs to the displayed month (vs. adjacent filler). */
  inMonth: boolean;
  /** The occurrences falling on this day (empty until filled). */
  occurrences: EventOccurrence[];
  /** The number of occurrences on this day (the day's "dot" count). */
  count: number;
}

/** A week row of the month grid (7 day cells, Sunday-first). */
export interface CalendarWeek {
  /** Stable key, e.g. "2026-09:1". */
  key: string;
  /** The 7 day cells of this week. */
  days: CalendarDay[];
}

/** The full month grid: an ordered list of weeks. */
export interface CalendarGrid {
  /** The displayed year. */
  year: number;
  /** The displayed month (1-12). */
  month: number;
  /** The weeks of the grid, in order. */
  weeks: CalendarWeek[];
}

/** A year/month pair, as produced by `navigateMonth`. */
export interface YearMonth {
  year: number;
  month: number;
}

/** Format a year/month pair as a YYYY-MM key (the API's `month` param). */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** A human month label for a year/month pair, e.g. "September 2026". */
export function monthLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 1);
  const monthName = date.toLocaleString("en-US", { month: "long" });
  return `${monthName} ${year}`;
}

/**
 * Navigate a year/month by a signed number of months.
 *
 * Handles year rollover (e.g. December +1 → January next year) and clamps to
 * the range 1-12. The result is always a valid calendar month.
 */
export function navigateMonth(year: number, month: number, delta: number): YearMonth {
  const totalMonths = year * 12 + (month - 1) + Math.trunc(delta);
  const newYear = Math.floor(totalMonths / 12);
  const normalized = ((totalMonths % 12) + 12) % 12;
  return { year: newYear, month: normalized + 1 };
}

/**
 * Build the month grid for a year/month (month is 1-12).
 *
 * Produces complete Sunday-first weeks that fully cover the month: the grid
 * starts on the Sunday on or before the 1st and ends on the Saturday on or
 * after the last day. Days from the adjacent months are included as filler
 * (with `inMonth === false`) so the grid always forms full weeks. Each day
 * cell starts with an empty occurrence list; use `withOccurrences` to fill it.
 */
export function monthGrid(year: number, month: number): CalendarGrid {
  if (month < 1 || month > 12) {
    throw new RangeError(`month must be 1-12, got ${month}`);
  }
  const firstOfMonth = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < totalCells; i += 1) {
    const date = new Date(year, month - 1, 1 - startOffset + i);
    const day: CalendarDay = {
      date,
      isoDate: toLocalDate(date),
      dayOfMonth: date.getDate(),
      inMonth: date.getFullYear() === year && date.getMonth() === month - 1,
      occurrences: [],
      count: 0,
    };
    const weekIndex = Math.floor(i / 7);
    if (!weeks[weekIndex]) {
      weeks[weekIndex] = { key: `${monthKey(year, month)}:${weekIndex + 1}`, days: [] };
    }
    weeks[weekIndex].days.push(day);
  }

  return { year, month, weeks };
}

/**
 * Filter the occurrences that fall on a given day.
 *
 * Compares each occurrence's local calendar date against the day cell's
 * `isoDate`. Used by the day drawer to list a selected day's events.
 */
export function dayOccurrences(
  occurrences: readonly EventOccurrence[],
  day: CalendarDay,
): EventOccurrence[] {
  return occurrences.filter((o) => {
    const date = parseIso(o.start_at);
    return date !== null && toLocalDate(date) === day.isoDate;
  });
}

/**
 * Fill a month grid with occurrences, deriving each day's event count/dots.
 *
 * Returns a new grid (the input is not mutated) where every day cell has its
 * `occurrences` list and `count` populated from the payload. Occurrences with
 * an unparseable `start_at` are dropped (they cannot be placed on the grid).
 */
export function withOccurrences(
  grid: CalendarGrid,
  occurrences: readonly EventOccurrence[],
): CalendarGrid {
  const byDay = new Map<string, EventOccurrence[]>();
  for (const o of occurrences) {
    const date = parseIso(o.start_at);
    if (!date) continue;
    const key = toLocalDate(date);
    const list = byDay.get(key);
    if (list) list.push(o);
    else byDay.set(key, [o]);
  }
  return {
    ...grid,
    weeks: grid.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => {
        const list = byDay.get(day.isoDate) ?? [];
        return { ...day, occurrences: list, count: list.length };
      }),
    })),
  };
}

/** A fully derived row for a single occurrence in the day drawer. */
export interface OccurrenceRow {
  /** The underlying occurrence. */
  occurrence: EventOccurrence;
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
  /** Human time label for the occurrence's start. */
  timeLabel: string;
  /** A human "next occurrence" hint, or null when none is available. */
  nextOccurrenceLabel: string | null;
}

/** Format an occurrence's start for display, e.g. "Sat, Sep 5 · 10:00 AM". */
function occurrenceTimeLabel(o: EventOccurrence): string {
  const parsed = parseIso(o.start_at);
  if (!parsed) {
    return o.start_at;
  }
  const weekday = weekdayShort(parsed);
  const monthShort = parsed.toLocaleString("en-US", { month: "short" });
  const day = parsed.getDate();
  if (o.all_day) {
    return `${weekday}, ${monthShort} ${day}`;
  }
  const hour = parsed.getHours();
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${weekday}, ${monthShort} ${day} · ${hour12}:${minute} ${period}`;
}

/** Format a next-occurrence timestamp as a short hint, e.g. "Next: Sun, Oct 4". */
function nextOccurrenceLabel(next: string | null): string | null {
  if (!next) {
    return null;
  }
  const parsed = parseIso(next);
  if (!parsed) {
    return next;
  }
  const monthShort = parsed.toLocaleString("en-US", { month: "short" });
  return `Next: ${weekdayShort(parsed)}, ${monthShort} ${parsed.getDate()}`;
}

/**
 * Derive the display row for an occurrence in the day drawer.
 *
 * Builds the priority/tag styling, the recurrence badge (via
 * `formatRecurrence`) and the time + next-occurrence labels. One-time events
 * yield a `null` recurrence badge.
 */
export function toOccurrenceRow(o: EventOccurrence): OccurrenceRow {
  const priority = priorityStyle(o.priority);
  const tag = o.tag ? tagStyle(o.tag) : null;
  const badge = formatRecurrence(o.rrule);
  return {
    occurrence: o,
    priorityColor: priority.color,
    priorityIcon: priority.icon,
    tagColor: tag?.color ?? "text-slate-500 bg-transparent border-transparent",
    tagIcon: tag?.icon ?? "#",
    recurrenceBadge: badge.known ? badge.label : null,
    timeLabel: occurrenceTimeLabel(o),
    nextOccurrenceLabel: nextOccurrenceLabel(o.next_occurrence),
  };
}
