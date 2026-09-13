import { useCallback, useEffect, useMemo, useState } from "react";
import { useServices } from "../services/useServices";
import {
  eventNextOccurrences,
  reminderPreview,
  type ReminderPreview,
} from "../../core/eventDrawer";
import { toOccurrenceRow, type OccurrenceRow } from "../../core/calendar";
import { monthKey } from "../../core/calendar";
import { parseIso } from "../../core/dateFmt";
import type { EventOccurrence, EventRead } from "../../core/eventTypes";

/** The maximum number of next occurrences shown in the drawer. */
export const NEXT_OCCURRENCE_LIMIT = 5;

/** A next-occurrence row: the raw occurrence plus its derived display row. */
export interface DrawerOccurrence {
  /** The underlying occurrence. */
  occurrence: EventOccurrence;
  /** The derived display row (priority/tag/time labels). */
  row: OccurrenceRow;
}

/** State shape produced by the event-drawer view model. */
export interface EventDrawerState {
  /** The selected event, or null when the drawer is closed. */
  event: EventRead | null;
  /** Whether the drawer is open. */
  open: boolean;
  /** Whether the next-occurrences data is still loading. */
  loading: boolean;
  /** A human error message, or null when there is none. */
  error: string | null;
  /** The derived reminder preview, or null when no event is selected. */
  preview: ReminderPreview | null;
  /** The event's next occurrences (sorted, limited). */
  occurrences: DrawerOccurrence[];
  /** Open the drawer for a given event. */
  openDrawer: (event: EventRead) => void;
  /** Open the drawer for an event occurrence (fetches the full event). */
  openFromOccurrence: (occurrence: EventOccurrence) => Promise<void>;
  /** Close the drawer. */
  close: () => void;
}

/**
 * Thin view model for the read-only event drawer (issue #38).
 *
 * No business logic here — it holds the selected event, fetches the month's
 * occurrences through the injected `apiClient`, and delegates the reminder
 * preview and next-occurrence derivation to the pure `src/core/eventDrawer`.
 * The component renders the resulting state.
 */
export function useEventDrawer(): EventDrawerState {
  const { apiClient } = useServices();
  const [event, setEvent] = useState<EventRead | null>(null);
  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The month whose occurrences we fetch: the selected event's start month.
  const month = useMemo(() => {
    if (!event) return null;
    const start = parseIso(event.start_at);
    if (!start) return null;
    return monthKey(start.getFullYear(), start.getMonth() + 1);
  }, [event]);

  useEffect(() => {
    if (!month) {
      setOccurrences([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .getOccurrences(month)
      .then((list) => {
        if (cancelled) return;
        setOccurrences(list);
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
  }, [apiClient, month]);

  const openDrawer = useCallback((selected: EventRead) => {
    setEvent(selected);
    setError(null);
  }, []);

  const openFromOccurrence = useCallback(
    async (occurrence: EventOccurrence) => {
      setError(null);
      try {
        const full = await apiClient.getEvent(occurrence.event_id);
        setEvent(full);
      } catch {
        setError("Failed to load event");
      }
    },
    [apiClient],
  );

  const close = useCallback(() => {
    setEvent(null);
    setOccurrences([]);
    setError(null);
  }, []);

  // Esc closes the drawer.
  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [event, close]);

  const preview = useMemo(
    () => (event ? reminderPreview(event) : null),
    [event],
  );

  const nextOccurrences = useMemo(() => {
    if (!event) return [];
    return eventNextOccurrences(occurrences, event.id, NEXT_OCCURRENCE_LIMIT);
  }, [event, occurrences]);

  const drawerOccurrences = useMemo(
    () =>
      nextOccurrences.map((o) => ({ occurrence: o, row: toOccurrenceRow(o) })),
    [nextOccurrences],
  );

  return {
    event,
    open: event !== null,
    loading,
    error,
    preview,
    occurrences: drawerOccurrences,
    openDrawer,
    openFromOccurrence,
    close,
  };
}
