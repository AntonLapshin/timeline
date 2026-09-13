import { describe, it, expect } from "vitest";
import {
  formatReminderOffsets,
  reminderPreview,
  eventNextOccurrences,
} from "../../src/core/eventDrawer";
import type { EventOccurrence, EventRead } from "../../src/core/eventTypes";

function makeEvent(overrides: Partial<EventRead> = {}): EventRead {
  return {
    id: 1,
    title: "HRA",
    description: "Annual health check-up",
    location_url: "",
    tags: ["health"],
    type: "recurrent",
    start_at: "2026-09-05T10:00:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: "FREQ=MONTHLY;INTERVAL=3",
    priority: "critical",
    channels: ["telegram"],
    reminder_offsets: ["7d", "1d", "2h"],
    remind_time_of_day: "09:00",
    repeat_until_ack: false,
    snooze_allowed: true,
    email_enabled: false,
    email_to: null,
    source: "web",
    raw_input: null,
    ai_confidence: null,
    status: "active",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

function makeOccurrence(overrides: Partial<EventOccurrence>): EventOccurrence {
  return {
    event_id: 1,
    title: "HRA",
    priority: "critical",
    tag: "health",
    rrule: "FREQ=MONTHLY;INTERVAL=3",
    start_at: "2026-09-05T10:00:00",
    all_day: false,
    tz: "UTC",
    next_occurrence: "2026-12-05T10:00:00",
    ...overrides,
  };
}

describe("formatReminderOffsets", () => {
  it("joins offsets with a spaced slash", () => {
    expect(formatReminderOffsets(["7d", "1d", "2h"])).toBe("7d / 1d / 2h");
  });

  it("returns an empty string for an empty list", () => {
    expect(formatReminderOffsets([])).toBe("");
  });

  it("returns a single offset unchanged", () => {
    expect(formatReminderOffsets(["0m"])).toBe("0m");
  });

  it("drops blank entries", () => {
    expect(formatReminderOffsets(["7d", "", "1d"])).toBe("7d / 1d");
  });
});

describe("reminderPreview", () => {
  it("derives channels, offsets label and time of day", () => {
    const preview = reminderPreview(makeEvent());
    expect(preview.channels).toEqual(["telegram"]);
    expect(preview.offsetsLabel).toBe("7d / 1d / 2h");
    expect(preview.timeOfDay).toBe("09:00");
    expect(preview.hasReminders).toBe(true);
  });

  it("hasReminders is false when there are no channels", () => {
    const preview = reminderPreview(makeEvent({ channels: [] }));
    expect(preview.hasReminders).toBe(false);
  });

  it("hasReminders is false when there are no offsets", () => {
    const preview = reminderPreview(makeEvent({ reminder_offsets: [] }));
    expect(preview.hasReminders).toBe(false);
  });

  it("handles a null remind_time_of_day", () => {
    const preview = reminderPreview(makeEvent({ remind_time_of_day: null }));
    expect(preview.timeOfDay).toBeNull();
  });

  it("handles multiple channels and email offsets", () => {
    const preview = reminderPreview(
      makeEvent({ channels: ["telegram", "email"], reminder_offsets: ["1d"] }),
    );
    expect(preview.channels).toEqual(["telegram", "email"]);
    expect(preview.offsetsLabel).toBe("1d");
  });

  it("falls back to empty arrays when channels/offsets are absent", () => {
    const event = makeEvent() as unknown as Record<string, unknown>;
    delete event.channels;
    delete event.reminder_offsets;
    const preview = reminderPreview(event as unknown as EventRead);
    expect(preview.channels).toEqual([]);
    expect(preview.offsetsLabel).toBe("");
    expect(preview.hasReminders).toBe(false);
  });
});

describe("eventNextOccurrences", () => {
  const occurrences = [
    makeOccurrence({ start_at: "2026-09-10T10:00:00", event_id: 1 }),
    makeOccurrence({ start_at: "2026-09-05T10:00:00", event_id: 1 }),
    makeOccurrence({ start_at: "2026-09-20T10:00:00", event_id: 2 }),
    makeOccurrence({ start_at: "2026-09-15T10:00:00", event_id: 1 }),
  ];

  it("filters to the given event and sorts chronologically", () => {
    const result = eventNextOccurrences(occurrences, 1, 10);
    expect(result.map((o) => o.start_at)).toEqual([
      "2026-09-05T10:00:00",
      "2026-09-10T10:00:00",
      "2026-09-15T10:00:00",
    ]);
  });

  it("limits the number of returned occurrences", () => {
    const result = eventNextOccurrences(occurrences, 1, 2);
    expect(result).toHaveLength(2);
    expect(result[0].start_at).toBe("2026-09-05T10:00:00");
    expect(result[1].start_at).toBe("2026-09-10T10:00:00");
  });

  it("returns an empty list when the event has no occurrences", () => {
    expect(eventNextOccurrences(occurrences, 99, 10)).toEqual([]);
  });

  it("returns an empty list for a non-positive limit", () => {
    expect(eventNextOccurrences(occurrences, 1, 0)).toEqual([]);
    expect(eventNextOccurrences(occurrences, 1, -3)).toEqual([]);
  });

  it("does not include occurrences of other events", () => {
    const result = eventNextOccurrences(occurrences, 2, 10);
    expect(result).toHaveLength(1);
    expect(result[0].event_id).toBe(2);
  });

  it("returns an empty list for a non-finite limit", () => {
    expect(eventNextOccurrences(occurrences, 1, Number.NaN)).toEqual([]);
    expect(eventNextOccurrences(occurrences, 1, Number.POSITIVE_INFINITY)).toEqual([]);
  });
});
