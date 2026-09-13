import { useCallback, useState } from "react";
import { EMPTY_FILTER, type EventFilter } from "../../core/searchFilter";
import type { EventPriority } from "../../core/eventTypes";

/** State shape produced by the search/filter view model. */
export interface SearchFilterState {
  /** The current combined filter. */
  filter: EventFilter;
  /** Update the free-text query. */
  setText: (text: string) => void;
  /** Update the priority filter (null clears it). */
  setPriority: (priority: EventPriority | null) => void;
  /** Update the tag filter (null clears it). */
  setTag: (tag: string | null) => void;
  /** Update the month filter (null clears it). */
  setMonth: (month: string | null) => void;
  /** Clear all filters back to the empty state. */
  clear: () => void;
}

/**
 * Thin view model for the app-wide search/filter (issue #46).
 *
 * Holds only the filter state and its setters; all matching/filtering logic
 * lives in the pure `src/core/searchFilter` module. No business logic here.
 */
export function useSearchFilter(): SearchFilterState {
  const [filter, setFilter] = useState<EventFilter>(EMPTY_FILTER);

  const setText = useCallback(
    (text: string) => setFilter((f) => ({ ...f, text })),
    [],
  );
  const setPriority = useCallback(
    (priority: EventPriority | null) => setFilter((f) => ({ ...f, priority })),
    [],
  );
  const setTag = useCallback(
    (tag: string | null) => setFilter((f) => ({ ...f, tag })),
    [],
  );
  const setMonth = useCallback(
    (month: string | null) => setFilter((f) => ({ ...f, month })),
    [],
  );
  const clear = useCallback(() => setFilter(EMPTY_FILTER), []);

  return { filter, setText, setPriority, setTag, setMonth, clear };
}
