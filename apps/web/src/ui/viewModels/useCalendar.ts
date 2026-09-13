import { useCallback, useEffect, useMemo, useState } from "react";
import { useServices } from "../services/useServices";
import {
  monthGrid,
  monthKey,
  monthLabel,
  navigateMonth,
  withOccurrences,
  type CalendarDay,
  type CalendarGrid,
  type YearMonth,
} from "../../core/calendar";
import type { EventOccurrence } from "../../core/eventTypes";

/** State shape produced by the calendar view model. */
export interface CalendarState {
  /** The filled month grid (weeks × days with per-day counts). */
  grid: CalendarGrid;
  /** Human label for the displayed month, e.g. "September 2026". */
  monthLabel: string;
  /** The currently selected day (for the drawer), or null. */
  selectedDay: CalendarDay | null;
  /** Whether the current month's occurrences are still loading. */
  loading: boolean;
  /** A human error message, or null when there is none. */
  error: string | null;
  /** Go to the previous month. */
  prevMonth: () => void;
  /** Go to the next month. */
  nextMonth: () => void;
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
export function useCalendar(): CalendarState {
  const { apiClient } = useServices();
  const today = new Date();
  const [cursor, setCursor] = useState<YearMonth>({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });
  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);

  const key = monthKey(cursor.year, cursor.month);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .getOccurrences(key)
      .then((list) => {
        if (cancelled) return;
        setOccurrences(list);
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
  }, [apiClient, key]);

  const grid = useMemo(
    () => withOccurrences(monthGrid(cursor.year, cursor.month), occurrences),
    [cursor, occurrences],
  );

  const selectedDay = useMemo(() => {
    if (!selectedIso) return null;
    for (const week of grid.weeks) {
      const found = week.days.find((d) => d.isoDate === selectedIso);
      if (found) return found;
    }
    return null;
  }, [grid, selectedIso]);

  const prevMonth = useCallback(
    () => setCursor((c) => navigateMonth(c.year, c.month, -1)),
    [],
  );
  const nextMonth = useCallback(
    () => setCursor((c) => navigateMonth(c.year, c.month, 1)),
    [],
  );
  const selectDay = useCallback((day: CalendarDay) => setSelectedIso(day.isoDate), []);
  const closeDrawer = useCallback(() => setSelectedIso(null), []);

  return {
    grid,
    monthLabel: monthLabel(cursor.year, cursor.month),
    selectedDay,
    loading,
    error,
    prevMonth,
    nextMonth,
    selectDay,
    closeDrawer,
  };
}
