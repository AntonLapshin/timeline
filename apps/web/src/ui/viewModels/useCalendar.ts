import { useCallback, useEffect, useMemo, useState } from "react";
import { useServices } from "../services/useServices";
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

/** The three Calendar sub-modes. */
export type CalendarMode = "month" | "week" | "agenda";

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
 */
export function useCalendar(
  filter?: EventFilter,
  /** Bump to re-run the occurrence fetch (e.g. after a wizard save, issue #121). */
  refreshKey = 0,
): CalendarState {
  const { apiClient } = useServices();
  const today = new Date();
  const [cursor, setCursor] = useState<YearMonth>({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });
  const [weekCursor, setWeekCursor] = useState<Date>(() => weekStart(today));
  const [mode, setMode] = useState<CalendarMode>("month");
  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);

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
        if (cancelled) return;
        setError("Failed to load occurrences");
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

  const prevMonth = useCallback(
    () => setCursor((c) => navigateMonth(c.year, c.month, -1)),
    [],
  );
  const nextMonth = useCallback(
    () => setCursor((c) => navigateMonth(c.year, c.month, 1)),
    [],
  );
  const prevWeek = useCallback(
    () => setWeekCursor((w) => navigateWeek(w, -1)),
    [],
  );
  const nextWeek = useCallback(
    () => setWeekCursor((w) => navigateWeek(w, 1)),
    [],
  );
  const selectDay = useCallback((day: CalendarDay) => setSelectedIso(day.isoDate), []);
  const closeDrawer = useCallback(() => setSelectedIso(null), []);

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
