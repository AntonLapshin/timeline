import { useCallback, useMemo } from "react";
import { type EventFilter } from "../../core/searchFilter";
import type { EventPriority } from "../../core/eventTypes";
import { EVENT_PRIORITIES } from "../../core/eventTypes";
import { useUrlBatchUpdate, useUrlState } from "../services/useUrlState";
import {
  FILTER_MONTH_PARAM,
  FILTER_PRIORITY_PARAM,
  FILTER_TAG_PARAM,
  SEARCH_TEXT_PARAM,
} from "../services/urlParams";

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
 *
 * The filter is deep-linked: free-text (`?q=`), priority (`?priority=`), tag
 * (`?tag=`) and month (`?fmonth=`) live in the URL via `use-state-in-url`,
 * so filtered views are shareable and back/forward-aware. The text query
 * uses `replace` navigation so typing does not spam the history.
 */
export function useSearchFilter(): SearchFilterState {
  const [text, setTextParam, textUpdater] = useUrlState(SEARCH_TEXT_PARAM, {
    replace: true,
  });
  const [priorityRaw, setPriorityParam, priorityUpdater] = useUrlState(
    FILTER_PRIORITY_PARAM,
  );
  const [tagRaw, setTagParam, tagUpdater] = useUrlState(FILTER_TAG_PARAM);
  const [monthRaw, setMonthParam, monthUpdater] = useUrlState(FILTER_MONTH_PARAM);
  const { batchUpdate } = useUrlBatchUpdate();

  // Sanitize: a hand-crafted `?priority=bogus` falls back to "no filter".
  const priority = useMemo<EventPriority | null>(
    () =>
      (EVENT_PRIORITIES as readonly string[]).includes(priorityRaw)
        ? (priorityRaw as EventPriority)
        : null,
    [priorityRaw],
  );

  const filter = useMemo<EventFilter>(
    () => ({
      text,
      priority,
      tag: tagRaw === "" ? null : tagRaw,
      month: monthRaw === "" ? null : monthRaw,
    }),
    [text, priority, tagRaw, monthRaw],
  );

  const setText = useCallback(
    (next: string) => setTextParam(next),
    [setTextParam],
  );
  const setPriority = useCallback(
    (next: EventPriority | null) => setPriorityParam(next ?? ""),
    [setPriorityParam],
  );
  const setTag = useCallback(
    (next: string | null) => setTagParam(next ?? ""),
    [setTagParam],
  );
  const setMonth = useCallback(
    (next: string | null) => setMonthParam(next ?? ""),
    [setMonthParam],
  );
  // One history entry for the whole reset (not four).
  const clear = useCallback(
    () =>
      batchUpdate([
        textUpdater(""),
        priorityUpdater(""),
        tagUpdater(""),
        monthUpdater(""),
      ]),
    [batchUpdate, textUpdater, priorityUpdater, tagUpdater, monthUpdater],
  );

  return { filter, setText, setPriority, setTag, setMonth, clear };
}
