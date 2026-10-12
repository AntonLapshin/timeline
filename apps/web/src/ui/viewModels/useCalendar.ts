import { useCallback, useEffect, useMemo, useState } from "react";
import { useServices } from "../services/useServices";
import { useUrlState } from "../services/useUrlState";
import {
  CAL_DAY_PARAM,
  CAL_MODE_PARAM,
  CAL_MONTH_PARAM,
  CAL_WEEK_PARAM,
} from "../services/urlParams";
import {
  mergeOccurrences,
  monthGrid,
  monthKey,
  monthLabel,
  navigateMonth,
  navigateWeek,
  upcomingAgenda,
  weekGrid,
  weekStart,
  withOccurrences,
  withWeekOccurrences,
  type AgendaRow,
  type CalendarDay,
  type CalendarGrid,
  type CalendarWeekGrid,
  type YearMonth,
} from "../../core/calendar";
import {
  EMPTY_FILTER,
  filterOccurrences,
  type EventFilter,
} from "../../core/searchFilter";
import type { EventOccurrence } from "../../core/eventTypes";
import { toLocalDate } from "../../core/dateFmt";

/** The three Calendar sub-modes. */
export type CalendarMode = "month" | "week" | "agenda";

/** `YYYY-MM` for the given date (local). */
function monthKeyOf(date: Date): string {
  return monthKey(date.getFullYear(), date.getMonth() + 1);
}

/** `YYYY-MM-DD` for the given date (local). */
function dayKeyOf(date: Date): string {
  return toLocalDate(date);
}

/** Parse a `YYYY-MM` param into a cursor, or null when malformed. */
function parseMonthParam(value: string): YearMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Parse a `YYYY-MM-DD` param into a Date, or null when malformed. */
function parseDayParam(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** State shape produced by the calendar view model. */
export interface CalendarState {
  /** The currently active sub-mode. */
  mode: CalendarMode;
  /** Switch the active sub-mode. */
  setMode: (mode: CalendarMode) => void;
  /** The filled month grid (weeks × days with per-day counts). */
  grid: CalendarGrid;
  /** The filled week grid (7 day columns), or null when not in week mode. */
  week: CalendarWeekGrid | null;
  /** The derived agenda rows, or null when not in agenda mode. */
  agenda: AgendaRow[] | null;
  /** Human label for the displayed month, e.g. "September 2026". */
  monthLabel: string;
  /** Human label for the displayed week, e.g. "Sep 6 – Sep 12, 2026". */
  weekLabel: string;
  /** The currently selected day (for the drawer), or null. */
  selectedDay: CalendarDay | null;
  /** Whether the current month's occurrences are still loading. */
  loading: boolean;
  /** A human error message, or null when there is none. */
  error: string | null;
  /** Re-run the current month's occurrence fetch (e.g. after a failure). */
  retry: () => void;
  /** Go to the previous month. */
  prevMonth: () => void;
  /** Go to the next month. */
  nextMonth: () => void;
  /** Go to the previous week. */
  prevWeek: () => void;
  /** Go to the next week. */
  nextWeek: () => void;
  /** Open the day drawer for a given day. */
  selectDay: (day: CalendarDay) => void;
  /** Close the day drawer. */
  closeDrawer: () => void;
}

/**
 * Thin view model for the Calendar view (issue #28).
 *
 * No business logic here — it holds the displayed year/month cursor and the
 * selected day, fetches occurrences through the injected `apiClient`, and
 * delegates all grid/count/drawer derivation to the pure `src/core/calendar`
 * module. The component renders the resulting state.
 *
 * The calendar position is deep-linked via `use-state-in-url`: the sub-mode
 * (`?cal=week`), the visible month (`?month=2026-10`), the visible week
 * (`?week=2026-10-12`) and the day-drawer selection (`?day=2026-10-12`) all
 * live in the URL, so calendar views are shareable and back/forward-aware.
 * Absent params fall back to "today"; malformed params are ignored.
 */
export function useCalendar(
  filter?: EventFilter,
  /** Bump to re-run the occurrence fetch (e.g. after a wizard save, issue #121). */
  refreshKey = 0,
): CalendarState {
  const { apiClient } = useServices();
  // Fixed at mount: the "today" fallback for absent URL params and the
  // current-month/week cleanup in the navigation callbacks.
  const [today] = useState(() => new Date());
  const [modeRaw, setModeRaw] = useUrlState(CAL_MODE_PARAM);
  const [monthRaw, setMonthRaw] = useUrlState(CAL_MONTH_PARAM);
  const [weekRaw, setWeekRaw] = useUrlState(CAL_WEEK_PARAM);
  const [dayRaw, setDayRaw] = useUrlState(CAL_DAY_PARAM);

  // Sanitize: a hand-crafted `?cal=bogus` falls back to the month mode.
  const mode: CalendarMode =
    modeRaw === "week" || modeRaw === "agenda" ? modeRaw : "month";

  // Absent/malformed `?month=` falls back to the current month.
  const cursor: YearMonth = useMemo(() => {
    const parsed = monthRaw ? parseMonthParam(monthRaw) : null;
    if (parsed) return parsed;
    return { year: today.getFullYear(), month: today.getMonth() + 1 };
  }, [monthRaw, today]);

  // Absent/malformed `?week=` falls back to the current week.
  const weekCursor: Date = useMemo(() => {
    const parsed = weekRaw ? parseDayParam(weekRaw) : null;
    return weekStart(parsed ?? today);
  }, [weekRaw, today]);

  const selectedIso = useMemo(
    () => (dayRaw && parseDayParam(dayRaw) ? dayRaw : null),
    [dayRaw],
  );

  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The grid shows adjacent-month filler days and the week/agenda modes look
  // beyond the displayed month, so occurrences for the previous, current and
  // next months are fetched together (in parallel) and merged. Without the
  // neighbours, filler days stay empty and the agenda misses upcoming
  // occurrences just across the month boundary (e.g. an Oct 1 quarterly
  // occurrence while viewing September).
  const keys = useMemo(() => {    const prev = navigateMonth(cursor.year, cursor.month, -1);
    const next = navigateMonth(cursor.year, cursor.month, 1);
    return [
      monthKey(prev.year, prev.month),
      monthKey(cursor.year, cursor.month),
      monthKey(next.year, next.month),
    ];
  }, [cursor]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(keys.map((month) => apiClient.getOccurrences(month)))
      .then((lists) => {
        if (cancelled) return;
        setOccurrences(mergeOccurrences(lists));
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load occurrences");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `refreshKey` re-runs the fetch so a wizard save is reflected in the
    // grid without a reload (issue #121).
  }, [apiClient, keys, refreshKey]);

  const filtered = useMemo(
    () => filterOccurrences(occurrences, filter ?? EMPTY_FILTER),
    [occurrences, filter],
  );

  const grid = useMemo(
    () => withOccurrences(monthGrid(cursor.year, cursor.month), filtered),
    [cursor, filtered],
  );

  const week = useMemo(
    () => withWeekOccurrences(weekGrid(weekCursor), filtered),
    [weekCursor, filtered],
  );

  const agenda = useMemo(
    () => upcomingAgenda(filtered, new Date()),
    [filtered],
  );

  const selectedDay = useMemo(() => {
    if (!selectedIso) return null;
    for (const weekRow of grid.weeks) {
      const found = weekRow.days.find((d) => d.isoDate === selectedIso);
      if (found) return found;
    }
    return null;
  }, [grid, selectedIso]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all(keys.map((month) => apiClient.getOccurrences(month)))
      .then((lists) => {
        setOccurrences(mergeOccurrences(lists));
        setError(null);
      })
      .catch(() => {
        setError("Failed to load occurrences");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiClient, keys]);

  const setMode = useCallback(
    (next: CalendarMode) => setModeRaw(next),
    [setModeRaw],
  );

  // Navigating back to the current month/week removes the param (falling
  // back to "today"); any other position is written explicitly so the link
  // stays stable.
  const prevMonth = useCallback(() => {
    const next = navigateMonth(cursor.year, cursor.month, -1);
    const key = monthKey(next.year, next.month);
    setMonthRaw(key === monthKeyOf(today) ? "" : key);
  }, [cursor, setMonthRaw, today]);
  const nextMonth = useCallback(() => {
    const next = navigateMonth(cursor.year, cursor.month, 1);
    const key = monthKey(next.year, next.month);
    setMonthRaw(key === monthKeyOf(today) ? "" : key);
  }, [cursor, setMonthRaw, today]);
  const prevWeek = useCallback(() => {
    const next = navigateWeek(weekCursor, -1);
    const key = dayKeyOf(next);
    setWeekRaw(key === dayKeyOf(weekStart(today)) ? "" : key);
  }, [weekCursor, setWeekRaw, today]);
  const nextWeek = useCallback(() => {
    const next = navigateWeek(weekCursor, 1);
    const key = dayKeyOf(next);
    setWeekRaw(key === dayKeyOf(weekStart(today)) ? "" : key);
  }, [weekCursor, setWeekRaw, today]);
  const selectDay = useCallback(
    (day: CalendarDay) => setDayRaw(day.isoDate),
    [setDayRaw],
  );
  const closeDrawer = useCallback(() => setDayRaw(""), [setDayRaw]);

  return {
    mode,
    setMode,
    grid,
    week,
    agenda,
    monthLabel: monthLabel(cursor.year, cursor.month),
    weekLabel: week.label,
    selectedDay,
    loading,
    error,
    prevMonth,
    nextMonth,
    prevWeek,
    nextWeek,
    selectDay,
    closeDrawer,
    retry,
  };
}
