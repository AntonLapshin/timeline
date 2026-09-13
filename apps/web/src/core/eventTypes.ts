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

/** Counts of event occurrences in a month, as returned by `GET /api/summary`. */
export interface SummaryResponse {
  month: string;
  total: number;
  by_priority: Record<string, number>;
}
