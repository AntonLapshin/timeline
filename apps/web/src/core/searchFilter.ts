/**
 * Search / filter over events (issue #46).
 *
 * Pure business logic for the app-wide search box and filter controls: free-text
 * matching across title/notes/tags, plus priority, tag and month filters, all
 * combinable with AND semantics. Also derives the distinct tag and month option
 * lists for the filter dropdowns. No React, no Tailwind imports, no browser
 * APIs — only data transformation over `EventRead` / `EventOccurrence` values.
 */

import type { EventOccurrence, EventPriority, EventRead } from "./eventTypes";
import { parseIso, toLocalDate } from "./dateFmt";

/** A combined search + filter query over events. */
export interface EventFilter {
  /** Free-text query, matched case-insensitively against title/notes/tags. */
  text: string;
  /** Only events with this priority, or null for any. */
  priority: EventPriority | null;
  /** Only events carrying this tag, or null for any. */
  tag: string | null;
  /** Only events starting in this month (YYYY-MM), or null for any. */
  month: string | null;
}

/** The default filter: no filtering applied. */
export const EMPTY_FILTER: EventFilter = {
  text: "",
  priority: null,
  tag: null,
  month: null,
};

/** Normalize a free-text query for case-insensitive matching. */
export function normalizeQuery(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Whether a free-text query matches any of the given fields.
 *
 * An empty (after trimming) query matches everything. Matching is
 * case-insensitive substring matching on the space-joined fields.
 */
function matchesTextFields(fields: readonly string[], text: string): boolean {
  const needle = normalizeQuery(text);
  if (needle === "") {
    return true;
  }
  return fields.join(" ").toLowerCase().includes(needle);
}

/** Whether an event matches a free-text query across title, notes and tags. */
export function eventMatchesText(event: EventRead, text: string): boolean {
  return matchesTextFields([event.title, event.description, ...event.tags], text);
}

/** Whether an occurrence matches a free-text query across title and tag. */
export function occurrenceMatchesText(
  occurrence: EventOccurrence,
  text: string,
): boolean {
  return matchesTextFields([occurrence.title, occurrence.tag ?? ""], text);
}

/** The YYYY-MM month of an event's start, or null if unparseable. */
export function eventMonth(event: EventRead): string | null {
  const parsed = parseIso(event.start_at);
  return parsed ? toLocalDate(parsed).slice(0, 7) : null;
}

/** The YYYY-MM month of an occurrence's start, or null if unparseable. */
export function occurrenceMonth(occurrence: EventOccurrence): string | null {
  const parsed = parseIso(occurrence.start_at);
  return parsed ? toLocalDate(parsed).slice(0, 7) : null;
}

/** Whether any filter criterion is currently active. */
export function isFiltering(filter: EventFilter): boolean {
  return (
    normalizeQuery(filter.text) !== "" ||
    filter.priority !== null ||
    filter.tag !== null ||
    filter.month !== null
  );
}

/**
 * Filter events by text, priority, tag and month (AND semantics).
 *
 * When no filter is active the input is returned unchanged (a copy), so the
 * result is always safe to mutate / derive from.
 */
export function filterEvents(
  events: readonly EventRead[],
  filter: EventFilter,
): EventRead[] {
  if (!isFiltering(filter)) {
    return [...events];
  }
  return events.filter((event) => {
    if (!eventMatchesText(event, filter.text)) {
      return false;
    }
    if (filter.priority !== null && event.priority !== filter.priority) {
      return false;
    }
    if (filter.tag !== null && !event.tags.includes(filter.tag)) {
      return false;
    }
    if (filter.month !== null && eventMonth(event) !== filter.month) {
      return false;
    }
    return true;
  });
}

/**
 * Filter occurrences by text, priority, tag and month (AND semantics).
 *
 * Used by the Calendar view (which works over occurrences rather than events).
 */
export function filterOccurrences(
  occurrences: readonly EventOccurrence[],
  filter: EventFilter,
): EventOccurrence[] {
  if (!isFiltering(filter)) {
    return [...occurrences];
  }
  return occurrences.filter((occurrence) => {
    if (!occurrenceMatchesText(occurrence, filter.text)) {
      return false;
    }
    if (
      filter.priority !== null &&
      occurrence.priority !== filter.priority
    ) {
      return false;
    }
    if (filter.tag !== null && occurrence.tag !== filter.tag) {
      return false;
    }
    if (filter.month !== null && occurrenceMonth(occurrence) !== filter.month) {
      return false;
    }
    return true;
  });
}

/** The distinct tags across events, sorted alphabetically. */
export function allTags(events: readonly EventRead[]): string[] {
  const tags = new Set<string>();
  for (const event of events) {
    for (const tag of event.tags) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}

/** The distinct start months (YYYY-MM) across events, sorted. */
export function allMonths(events: readonly EventRead[]): string[] {
  const months = new Set<string>();
  for (const event of events) {
    const month = eventMonth(event);
    if (month) {
      months.add(month);
    }
  }
  return [...months].sort();
}
