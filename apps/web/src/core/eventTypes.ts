/**
 * Wire types shared across the timeline web core (schema v1).
 *
 * These mirror the canonical shared event schema
 * (`packages/shared/schemas/event.schema.v1.json`) and the API response
 * models (`apps/api/app/schemas.py`), so the web UI has one place that
 * describes the JSON it sends and receives. Pure TypeScript — no React, no
 * browser APIs.
 */

/** Reminder priority level. */
export type EventPriority = "critical" | "medium" | "low";

/** All priority values in canonical order. */
export const EVENT_PRIORITIES: readonly EventPriority[] = [
  "critical",
  "medium",
  "low",
];

/** Reminder delivery channels. */
export type EventChannel = "telegram" | "email";

/** All channel values. */
export const EVENT_CHANNELS: readonly EventChannel[] = ["telegram", "email"];

/** Lifecycle status of an event. */
export type EventStatus = "draft" | "active" | "archived";

/** Whether the event recurs. */
export type EventType = "one_time" | "recurrent";

/** How an event was captured. */
export type EventSource = "web" | "telegram_text" | "telegram_voice" | "ai";

/** A persisted event as returned by `GET /api/events`. */
export interface EventRead {
  id: number;
  title: string;
  description: string;
  location_url: string;
  tags: string[];
  type: EventType;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  tz: string;
  rrule: string | null;
  priority: EventPriority;
  channels: EventChannel[];
  reminder_offsets: string[];
  remind_time_of_day: string | null;
  repeat_until_ack: boolean;
  snooze_allowed: boolean;
  email_enabled: boolean;
  email_to: string | null;
  source: EventSource;
  raw_input: string | null;
  ai_confidence: number | null;
  status: EventStatus;
  created_at: string;
  updated_at: string;
}

/** Payload for creating an event via `POST /api/events`. */
export interface EventCreate {
  title: string;
  description?: string;
  location_url?: string;
  tags?: string[];
  type: EventType;
  start_at: string;
  end_at?: string | null;
  all_day?: boolean;
  tz?: string;
  rrule?: string | null;
  priority?: EventPriority;
  channels?: EventChannel[];
  reminder_offsets?: string[];
  remind_time_of_day?: string | null;
  repeat_until_ack?: boolean;
  snooze_allowed?: boolean;
  email_enabled?: boolean;
  email_to?: string | null;
  source?: EventSource;
  raw_input?: string | null;
  ai_confidence?: number | null;
  status?: EventStatus;
}

/**
 * Partial payload for updating an event via `PATCH /api/events/{id}`.
 *
 * Every field is optional; `undefined` means "leave unchanged". Nullable
 * fields (e.g. `rrule`, `end_at`) must be sent explicitly as `null` to clear
 * them, mirroring the API's `EventUpdate` schema.
 */
export type EventUpdate = Partial<EventCreate>;

/** Counts of event occurrences in a month, as returned by `GET /api/summary`. */
export interface SummaryResponse {
  month: string;
  total: number;
  by_priority: Record<string, number>;
}

/**
 * A single concrete event occurrence within a month, as returned by
 * `GET /api/events/occurrences?month=YYYY-MM` (issue #27).
 *
 * Mirrors the API's `EventOccurrenceRead` schema: each entry is one concrete
 * occurrence of an event falling in the requested month, carrying the fields
 * the calendar grid needs to place it (title, priority, tag, rrule) plus
 * `next_occurrence` for the day drawer.
 */
export interface EventOccurrence {
  /** The owning event's id. */
  event_id: number;
  /** The event title. */
  title: string;
  /** The event priority (critical / medium / low). */
  priority: EventPriority;
  /** The event's first tag, for the tag badge, or null. */
  tag: string | null;
  /** The event's recurrence rule, or null for a one-time event. */
  rrule: string | null;
  /** ISO 8601 start timestamp of this occurrence. */
  start_at: string;
  /** Whether the event is all-day. */
  all_day: boolean;
  /** The event's IANA timezone. */
  tz: string;
  /** The next occurrence at/after the month, for the day drawer, or null. */
  next_occurrence: string | null;
}
