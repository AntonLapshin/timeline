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

import type { EventOccurrence, EventPriority } from "./eventTypes";
import {
  dateKeyForDisplay,
  displayParts,
  parseIso,
  relativeLabel,
  startOfDay,
  toLocalDate,
} from "./dateFmt";
import { formatRecurrence } from "./recurrenceFormat";
import { priorityStyle, tagStyle } from "./timeline";

/**
 * Gradient dot per priority, mirroring the event-row palette in
 * `src/core/timeline` (critical → rose/red, medium → amber/orange,
 * low → sky/indigo) so the month-grid dots instantly convey each day's
 * event mix. Gradient + shadow keeps tiny dots legible in both themes.
 */
export const PRIORITY_DOT_CLASSES: Record<EventPriority, string> = {
  critical: "bg-gradient-to-br from-rose-400 to-red-600 shadow-sm shadow-red-500/40",
  medium: "bg-gradient-to-br from-amber-300 to-orange-500 shadow-sm shadow-amber-500/40",
  low: "bg-gradient-to-br from-sky-300 to-indigo-400 shadow-sm shadow-sky-500/30",
};

/** Derive the month-grid dot color for a priority level. */
export function priorityDotClass(priority: EventPriority): string {
  return PRIORITY_DOT_CLASSES[priority] ?? PRIORITY_DOT_CLASSES.medium;
}

/**
 * Derive the dot colors for a day cell (up to `limit`, in occurrence order).
 *
 * One dot per occurrence, colored by that occurrence's priority, so mixed
 * days show a mixed set of dots.
 */
export function dayDotClasses(day: CalendarDay, limit = 3): string[] {
  return day.occurrences.slice(0, Math.max(0, limit)).map((o) => priorityDotClass(o.priority));
}

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
 * Each occurrence is placed by its calendar date **in its own timezone**
 * (`o.tz`), matching the backend month expansion (which interprets the month
 * in each event's timezone). Comparing raw browser-local dates instead is
 * what dropped/shifted occurrences across midnight for non-UTC zones.
 */
export function dayOccurrences(
  occurrences: readonly EventOccurrence[],
  day: CalendarDay,
): EventOccurrence[] {
  return occurrences.filter((o) => {
    const date = parseIso(o.start_at);
    if (date === null) {
      return false;
    }
    return dateKeyForDisplay(o.start_at, date, o.tz || undefined) === day.isoDate;
  });
}

/** Group occurrences by their calendar date in each occurrence's own timezone. */
function groupByDate(
  occurrences: readonly EventOccurrence[],
): Map<string, EventOccurrence[]> {
  const byDay = new Map<string, EventOccurrence[]>();
  for (const o of occurrences) {
    const date = parseIso(o.start_at);
    if (!date) continue;
    const key = dateKeyForDisplay(o.start_at, date, o.tz || undefined);
    const list = byDay.get(key);
    if (list) list.push(o);
    else byDay.set(key, [o]);
  }
  return byDay;
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
  const byDay = groupByDate(occurrences);
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
  /** Humanized relative label vs now, e.g. "today", "in 3 weeks". */
  relativeLabel: string | null;
}

/** Format an occurrence's start for display, e.g. "Sat, Sep 5 · 10:00 AM". */
function occurrenceTimeLabel(o: EventOccurrence): string {
  const parsed = parseIso(o.start_at);
  if (!parsed) {
    return o.start_at;
  }
  const parts = displayParts(o.start_at, parsed, o.tz || undefined);
  if (o.all_day) {
    return `${parts.weekday}, ${parts.monthShort} ${parts.day}`;
  }
  const period = parts.hour >= 12 ? "PM" : "AM";
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${parts.weekday}, ${parts.monthShort} ${parts.day} · ${hour12}:${String(parts.minute).padStart(2, "0")} ${period}`;
}

/** Format a next-occurrence timestamp as a short hint, e.g. "Next: Sun, Oct 4". */
function nextOccurrenceLabel(next: string | null, timeZone?: string): string | null {
  if (!next) {
    return null;
  }
  const parsed = parseIso(next);
  if (!parsed) {
    return next;
  }
  const parts = displayParts(next, parsed, timeZone);
  return `Next: ${parts.weekday}, ${parts.monthShort} ${parts.day}`;
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
    tagColor: tag?.color ?? "border-slate-200 bg-slate-100/60 text-slate-500 dark:border-slate-600/60 dark:bg-slate-700/40 dark:text-slate-400",
    tagIcon: tag?.icon ?? "#",
    recurrenceBadge: badge.known ? badge.label : null,
    timeLabel: occurrenceTimeLabel(o),
    nextOccurrenceLabel: nextOccurrenceLabel(o.next_occurrence, o.tz || undefined),
    relativeLabel: relativeLabel(o.start_at, new Date()),
  };
}

// ---------------------------------------------------------------------------
// Week grid (issue #29)
// ---------------------------------------------------------------------------

/** The Sunday that starts the week containing `date`. */
export function weekStart(date: Date): Date {
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay()));
}

/** The 7 day cells of the week starting at `start` (its Sunday). */
export function weekDays(start: Date): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({
      date,
      isoDate: toLocalDate(date),
      dayOfMonth: date.getDate(),
      inMonth: true,
      occurrences: [],
      count: 0,
    });
  }
  return days;
}

/** A human label for a week, e.g. "Sep 6 – Sep 12, 2026". */
export function weekLabel(start: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const monthDay = (d: Date) =>
    `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
  if (start.getFullYear() === end.getFullYear()) {
    return `${monthDay(start)} – ${monthDay(end)}, ${start.getFullYear()}`;
  }
  return `${monthDay(start)}, ${start.getFullYear()} – ${monthDay(end)}, ${end.getFullYear()}`;
}

/** A week grid: 7 consecutive day columns (Sunday-first). */
export interface CalendarWeekGrid {
  /** Stable key, e.g. "2026-09-06". */
  key: string;
  /** The Sunday that starts the week. */
  start: Date;
  /** Human label, e.g. "Sep 6 – Sep 12, 2026". */
  label: string;
  /** The 7 day columns. */
  days: CalendarDay[];
}

/** Build the week grid for the week starting at `start` (its Sunday). */
export function weekGrid(start: Date): CalendarWeekGrid {
  return {
    key: toLocalDate(start),
    start,
    label: weekLabel(start),
    days: weekDays(start),
  };
}

/** Navigate a week start by a signed number of weeks. */
export function navigateWeek(start: Date, delta: number): Date {
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta * 7);
}

/**
 * Fill a week grid's day columns with occurrences.
 *
 * Returns a new week grid (the input is not mutated) where every day column
 * has its `occurrences` list and `count` populated from the payload.
 */
export function withWeekOccurrences(
  week: CalendarWeekGrid,
  occurrences: readonly EventOccurrence[],
): CalendarWeekGrid {
  const byDay = groupByDate(occurrences);
  return {
    ...week,
    days: week.days.map((day) => {
      const list = byDay.get(day.isoDate) ?? [];
      return { ...day, occurrences: list, count: list.length };
    }),
  };
}

/** A day's occurrences split into all-day and timed groups, sorted by start. */
export interface DaySlots {
  /** All-day occurrences, sorted by start. */
  allDay: EventOccurrence[];
  /** Timed occurrences, sorted by start. */
  timed: EventOccurrence[];
}

/** Compare two occurrences by their start timestamp. */
function byStart(a: EventOccurrence, b: EventOccurrence): number {
  return a.start_at.localeCompare(b.start_at);
}

/**
 * Split a day's occurrences into all-day and timed groups, each sorted by
 * start time, so the week grid can place them (all-day on top, timed below).
 */
export function daySlots(day: CalendarDay): DaySlots {
  const allDay = day.occurrences.filter((o) => o.all_day).sort(byStart);
  const timed = day.occurrences.filter((o) => !o.all_day).sort(byStart);
  return { allDay, timed };
}

/** A short time-of-day label for an occurrence, e.g. "10:00 AM". */
export function timeLabel(o: EventOccurrence): string {
  const parsed = parseIso(o.start_at);
  if (!parsed) {
    return "";
  }
  const parts = displayParts(o.start_at, parsed, o.tz || undefined);
  const period = parts.hour >= 12 ? "PM" : "AM";
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${hour12}:${String(parts.minute).padStart(2, "0")} ${period}`;
}

// ---------------------------------------------------------------------------
// Agenda list (issue #29)
// ---------------------------------------------------------------------------

/** A fully derived row for the agenda list. */
export interface AgendaRow {
  /** The underlying occurrence. */
  occurrence: EventOccurrence;
  /** Human date label, e.g. "Sat, Sep 5". */
  dateLabel: string;
  /** Human time label, e.g. "10:00 AM" or "All day". */
  timeLabel: string;
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
  /** Humanized relative label vs now, e.g. "today", "in 3 weeks". */
  relativeLabel: string | null;
}

/** Derive a single agenda row from an occurrence. */
export function toAgendaRow(o: EventOccurrence): AgendaRow {
  const priority = priorityStyle(o.priority);
  const tag = o.tag ? tagStyle(o.tag) : null;
  const badge = formatRecurrence(o.rrule);
  const parsed = parseIso(o.start_at);
  const parts = parsed ? displayParts(o.start_at, parsed, o.tz || undefined) : null;
  return {
    occurrence: o,
    dateLabel: parts
      ? `${parts.weekday}, ${parts.monthShort} ${parts.day}`
      : o.start_at,
    timeLabel: o.all_day ? "All day" : timeLabel(o),
    priorityColor: priority.color,
    priorityIcon: priority.icon,
    tagColor: tag?.color ?? "border-slate-200 bg-slate-100/60 text-slate-500 dark:border-slate-600/60 dark:bg-slate-700/40 dark:text-slate-400",
    tagIcon: tag?.icon ?? "#",
    recurrenceBadge: badge.known ? badge.label : null,
    relativeLabel: relativeLabel(o.start_at, new Date()),
  };
}

/**
 * Derive the upcoming agenda rows from a set of occurrences.
 *
 * Filters to occurrences starting at/after `now`, sorts them chronologically
 * by start, and derives each row's display styling. Occurrences with an
 * unparseable `start_at` are dropped. The empty list is the agenda's empty
 * state (rendered by the component).
 */
export function upcomingAgenda(
  occurrences: readonly EventOccurrence[],
  now: Date,
): AgendaRow[] {
  return occurrences
    .filter((o) => {
      const date = parseIso(o.start_at);
      return date !== null && date.getTime() >= now.getTime();
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map(toAgendaRow);
}
