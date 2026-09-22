import { useCallback, useEffect, useMemo, useState } from "react";
import { useServices } from "../services/useServices";
import {
  buildTimelineRows,
  groupRows,
  paginate,
  hasMore,
  type EventRow,
  type MonthGroup,
} from "../../core/timeline";
import {
  EMPTY_FILTER,
  filterEvents,
  type EventFilter,
} from "../../core/searchFilter";
import type { EventRead } from "../../core/eventTypes";

/** Number of events revealed per "load more" page. */
export const TIMELINE_PAGE_SIZE = 10;

/** State shape produced by the timeline view model. */
export interface TimelineState {
  /** Rows visible so far (expanded occurrences, revealed by pagination). */
  visible: EventRow[];
  /** Grouped, derived view of the visible rows. */
  groups: MonthGroup[];
  /** Whether more events can be loaded. */
  hasMore: boolean;
  /** Whether the initial load is still in flight. */
  loading: boolean;
  /** A human error message, or null when there is none. */
  error: string | null;
  /** Reveal the next page of events. */
  loadMore: () => void;
  /** Re-run the initial fetch (e.g. after a failed load). */
  retry: () => void;
}

/**
 * Thin view model for the Timeline view (issue #21).
 *
 * No business logic here — it fetches events through the injected
 * `apiClient`, then delegates all grouping/styling/pagination derivation to the
 * pure `src/core/timeline` module. The component renders the resulting state.
 */
export function useTimeline(
  filter?: EventFilter,
  /** Bump to re-run the list fetch (e.g. after a wizard save, issue #121). */
  refreshKey = 0,
): TimelineState {
  const { apiClient } = useServices();
  const [events, setEvents] = useState<EventRead[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
    // Re-runs when `refreshKey` changes so a wizard save is reflected in the
    // timeline without a reload (issue #121).
  }, [apiClient, refreshKey]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .listEvents()
      .then((list) => {
        setEvents(list);
        setPage(0);
        setError(null);
      })
      .catch(() => {
        setError("Failed to load events");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiClient]);

  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const filtered = useMemo(
    () => filterEvents(events, filter ?? EMPTY_FILTER),
    [events, filter],
  );

  // Expand BEFORE paginating: a single recurrent master yields dozens of
  // rows, so paginating masters would still flood the first page with years
  // of occurrences. Paginating rows keeps each batch to TIMELINE_PAGE_SIZE
  // rows with infinite scroll revealing the rest.
  const allRows = useMemo(() => buildTimelineRows(filtered), [filtered]);

  const visible = useMemo(
    () => paginate(allRows, TIMELINE_PAGE_SIZE, page),
    [allRows, page],
  );

  const groups = useMemo(() => groupRows(visible), [visible]);

  const more = useMemo(
    () => hasMore(allRows, TIMELINE_PAGE_SIZE, page),
    [allRows, page],
  );

  return {
    visible,
    groups,
    hasMore: more,
    loading,
    error,
    loadMore,
    retry,
  };
}
