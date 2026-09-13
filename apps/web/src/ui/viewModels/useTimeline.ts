import { useCallback, useEffect, useMemo, useState } from "react";
import { useServices } from "../services/useServices";
import {
  groupByMonth,
  paginate,
  hasMore,
  type MonthGroup,
} from "../../core/timeline";
import type { EventRead } from "../../core/eventTypes";

/** Number of events revealed per "load more" page. */
export const TIMELINE_PAGE_SIZE = 10;

/** State shape produced by the timeline view model. */
export interface TimelineState {
  /** Events visible so far (revealed by pagination). */
  visible: EventRead[];
  /** Grouped, derived view of the visible events. */
  groups: MonthGroup[];
  /** Whether more events can be loaded. */
  hasMore: boolean;
  /** Whether the initial load is still in flight. */
  loading: boolean;
  /** A human error message, or null when there is none. */
  error: string | null;
  /** Reveal the next page of events. */
  loadMore: () => void;
}

/**
 * Thin view model for the Timeline view (issue #21).
 *
 * No business logic here — it fetches events through the injected
 * `apiClient`, then delegates all grouping/styling/pagination derivation to the
 * pure `src/core/timeline` module. The component renders the resulting state.
 */
export function useTimeline(): TimelineState {
  const { apiClient } = useServices();
  const [events, setEvents] = useState<EventRead[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listEvents()
      .then((list) => {
        if (cancelled) return;
        setEvents(list);
        setPage(0);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load events");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const visible = useMemo(
    () => paginate(events, TIMELINE_PAGE_SIZE, page),
    [events, page],
  );

  const groups = useMemo(() => groupByMonth(visible), [visible]);

  const more = useMemo(
    () => hasMore(events, TIMELINE_PAGE_SIZE, page),
    [events, page],
  );

  return {
    visible,
    groups,
    hasMore: more,
    loading,
    error,
    loadMore,
  };
}
