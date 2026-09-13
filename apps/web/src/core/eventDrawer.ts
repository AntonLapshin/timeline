/**
 * Event drawer derivation (issue #38).
 *
 * Pure business logic for the read-only event drawer: given a selected event,
 * derive a human reminder preview (channels + offsets + remind-time-of-day)
 * from its reminder config, and pick out the event's next occurrences from a
 * month's occurrence rows. No React, no browser APIs — only data
 * transformation.
 */

import type { EventChannel, EventOccurrence, EventRead } from "./eventTypes";

/** A renderable reminder preview derived from an event's reminder config. */
export interface ReminderPreview {
  /** The reminder delivery channels (telegram / email). */
  channels: EventChannel[];
  /** The reminder offsets joined for display, e.g. "7d / 1d / 2h". */
  offsetsLabel: string;
  /** The remind-time-of-day (HH:MM), or null when not set. */
  timeOfDay: string | null;
  /** Whether the event has any reminders configured. */
  hasReminders: boolean;
}

/**
 * Format a list of reminder offsets for display.
 *
 * Offsets are joined with " / " (e.g. `["7d", "1d", "2h"]` → `"7d / 1d / 2h"`).
 * An empty list yields an empty string. The order is preserved as-is.
 */
export function formatReminderOffsets(offsets: readonly string[]): string {
  return offsets.filter((o) => o.trim() !== "").join(" / ");
}

/**
 * Derive a reminder preview from an event's reminder config.
 *
 * Combines the delivery channels, the joined offset label and the
 * remind-time-of-day into one renderable model. `hasReminders` is true only
 * when the event has at least one channel and at least one offset.
 */
export function reminderPreview(event: EventRead): ReminderPreview {
  const channels = event.channels ?? [];
  const offsets = event.reminder_offsets ?? [];
  const offsetsLabel = formatReminderOffsets(offsets);
  return {
    channels,
    offsetsLabel,
    timeOfDay: event.remind_time_of_day ?? null,
    hasReminders: channels.length > 0 && offsets.length > 0,
  };
}

/**
 * Pick an event's next occurrences from a month's occurrence rows.
 *
 * Filters the supplied occurrences to the given event, sorts them
 * chronologically by start time, and returns the first `limit` of them. A
 * non-positive `limit` yields an empty list. The input order is not relied
 * upon — output is always sorted by `start_at`.
 */
export function eventNextOccurrences(
  occurrences: readonly EventOccurrence[],
  eventId: number,
  limit: number,
): EventOccurrence[] {
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return occurrences
    .filter((o) => o.event_id === eventId)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, count);
}
