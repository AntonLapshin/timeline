import { describe, it, expect } from "vitest";
import {
  EVENT_SCHEMA_V1,
  EVENT_SCHEMA_VERSION,
  EVENT_STATUSES,
  EVENT_SOURCES,
  EVENT_TYPES,
  EVENT_PRIORITIES,
  EVENT_CHANNELS,
  isEventStatus,
  isEventSource,
  isEventType,
  isEventPriority,
  isEventChannel,
} from "../src/eventSchema";

describe("shared event schema v1", () => {
  it("exposes the canonical schema with the expected title and version", () => {
    const schema = EVENT_SCHEMA_V1 as {
      title: string;
      $id: string;
      type: string;
    };
    expect(schema.title).toBe("Event");
    expect(schema.$id).toContain("event.schema.v1.json");
    expect(schema.type).toBe("object");
    expect(EVENT_SCHEMA_VERSION).toBe("v1");
  });

  it("declares the manifest §5 required fields", () => {
    const schema = EVENT_SCHEMA_V1 as { required: string[] };
    for (const field of [
      "title",
      "type",
      "start_at",
      "tz",
      "priority",
      "channels",
      "reminder_offsets",
      "source",
      "status",
    ]) {
      expect(schema.required).toContain(field);
    }
  });

  it("enumerates statuses, sources, types, priorities and channels", () => {
    expect(EVENT_STATUSES).toEqual(["draft", "active", "archived"]);
    expect(EVENT_SOURCES).toEqual([
      "web",
      "telegram_text",
      "telegram_voice",
      "ai",
    ]);
    expect(EVENT_TYPES).toEqual(["one_time", "recurrent"]);
    expect(EVENT_PRIORITIES).toEqual(["critical", "medium", "low"]);
    expect(EVENT_CHANNELS).toEqual(["telegram", "email"]);
  });

  it("validates membership for each enum", () => {
    expect(isEventStatus("active")).toBe(true);
    expect(isEventStatus("bogus")).toBe(false);
    expect(isEventSource("ai")).toBe(true);
    expect(isEventSource("phone")).toBe(false);
    expect(isEventType("recurrent")).toBe(true);
    expect(isEventType("daily")).toBe(false);
    expect(isEventPriority("critical")).toBe(true);
    expect(isEventPriority("high")).toBe(false);
    expect(isEventChannel("email")).toBe(true);
    expect(isEventChannel("sms")).toBe(false);
  });
});
