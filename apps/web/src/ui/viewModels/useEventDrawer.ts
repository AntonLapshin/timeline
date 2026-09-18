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
import { deliveryLogRows, type DeliveryLogRow } from "../../core/deliveryLog";
import type { DeliveryLog, EventOccurrence, EventRead } from "../../core/eventTypes";

/** The maximum number of next occurrences shown in the drawer. */
export const NEXT_OCCURRENCE_LIMIT = 5;

/** The maximum number of delivery-log rows shown in the drawer. */
export const DELIVERY_LOG_LIMIT = 8;

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
  /** Whether the delivery-log data is still loading. */
  deliveriesLoading: boolean;
  /** A human error message for the delivery log, or null. */
  deliveriesError: string | null;
  /** The event's delivery-log rows (newest-first, limited). */
  deliveries: DeliveryLogRow[];
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
  const [deliveriesRaw, setDeliveriesRaw] = useState<DeliveryLog[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!event) {
      setDeliveriesRaw([]);
      setDeliveriesLoading(false);
      setDeliveriesError(null);
      return;
    }
    let cancelled = false;
    setDeliveriesLoading(true);
    setDeliveriesError(null);
    apiClient
      .getEventDeliveries(event.id)
      .then((list) => {
        if (cancelled) return;
        setDeliveriesRaw(list);
      })
      .catch(() => {
        if (!cancelled) setDeliveriesError("Failed to load delivery log");
      })
      .finally(() => {
        if (!cancelled) setDeliveriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, event]);

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
    setDeliveriesRaw([]);
    setDeliveriesError(null);
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

  // Lock body scroll while the drawer is open so the page behind the
  // slide-over's backdrop cannot scroll (issue #122). The previous inline
  // overflow value is restored on close/unmount.
  useEffect(() => {
    if (!event) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [event]);

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

  const deliveries = useMemo(
    () => deliveryLogRows(deliveriesRaw).slice(0, DELIVERY_LOG_LIMIT),
    [deliveriesRaw],
  );

  return {
    event,
    open: event !== null,
    loading,
    error,
    preview,
    occurrences: drawerOccurrences,
    deliveriesLoading,
    deliveriesError,
    deliveries,
    openDrawer,
    openFromOccurrence,
    close,
  };
}
