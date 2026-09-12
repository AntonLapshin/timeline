/**
 * Shared event contract for timeline (schema v1, manifest §5).
 *
 * This module re-exports the canonical JSON Schema (packages/shared/schemas/
 * event.schema.v1.json) plus the pure enums/constants the web app and the API
 * both reference, so the wire format stays in one place.
 */

import eventSchemaV1 from "../schemas/event.schema.v1.json";

/** Canonical event JSON Schema (v1). */
export const EVENT_SCHEMA_V1: object = eventSchemaV1;

/** Version identifier for the shared event schema. */
export const EVENT_SCHEMA_VERSION = "v1";

/** Lifecycle status of an event. */
export type EventStatus = "draft" | "active" | "archived";

/** How an event was captured. */
export type EventSource =
  | "web"
  | "telegram_text"
  | "telegram_voice"
  | "ai";

/** Whether the event recurs. */
export type EventType = "one_time" | "recurrent";

/** Reminder priority level. */
export type EventPriority = "critical" | "medium" | "low";

/** Reminder delivery channels. */
export type EventChannel = "telegram" | "email";

/** All allowed event statuses. */
export const EVENT_STATUSES: readonly EventStatus[] = [
  "draft",
  "active",
  "archived",
];

/** All allowed event sources. */
export const EVENT_SOURCES: readonly EventSource[] = [
  "web",
  "telegram_text",
  "telegram_voice",
  "ai",
];

/** All allowed event types. */
export const EVENT_TYPES: readonly EventType[] = ["one_time", "recurrent"];

/** All allowed event priorities. */
export const EVENT_PRIORITIES: readonly EventPriority[] = [
  "critical",
  "medium",
  "low",
];

/** All allowed reminder channels. */
export const EVENT_CHANNELS: readonly EventChannel[] = ["telegram", "email"];

/** Whether a value is a valid event status. */
export function isEventStatus(value: string): value is EventStatus {
  return (EVENT_STATUSES as readonly string[]).includes(value);
}

/** Whether a value is a valid event source. */
export function isEventSource(value: string): value is EventSource {
  return (EVENT_SOURCES as readonly string[]).includes(value);
}

/** Whether a value is a valid event type. */
export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** Whether a value is a valid event priority. */
export function isEventPriority(value: string): value is EventPriority {
  return (EVENT_PRIORITIES as readonly string[]).includes(value);
}

/** Whether a value is a valid reminder channel. */
export function isEventChannel(value: string): value is EventChannel {
  return (EVENT_CHANNELS as readonly string[]).includes(value);
}
