import { describe, it, expect } from "vitest";
import { toOccurrenceRow } from "../../src/core/calendar";
import { eventTimeLabel } from "../../src/core/timeline";
import type { EventOccurrence } from "../../src/core/eventTypes";

function occ(overrides: Partial<EventOccurrence>): EventOccurrence {
  return {
    event_id: 1,
    title: "T",
    priority: "medium",
    tag: null,
    rrule: null,
    start_at: "2026-09-05T10:00:00+00:00",
    all_day: false,
    tz: "Europe/Berlin",
    next_occurrence: "2026-09-06T10:00:00+00:00",
    ...overrides,
  };
}

describe("timezone-aware event display", () => {
  it("renders an aware UTC occurrence in the event zone", () => {
    expect(toOccurrenceRow(occ()).timeLabel).toBe("Sat, Sep 5 · 12:00 PM");
    expect(toOccurrenceRow(occ()).nextOccurrenceLabel).toBe("Next: Sun, Sep 6");
  });
  it("renders a naive occurrence verbatim in the event zone", () => {
    expect(toOccurrenceRow(occ({ start_at: "2026-09-05T10:00:00" })).timeLabel).toBe(
      "Sat, Sep 5 · 10:00 AM",
    );
  });
  it("renders an aware event in its zone", () => {
    expect(
      eventTimeLabel({
        id: 1,
        title: "T",
        description: "",
        location_url: "",
        tags: [],
        type: "one_time",
        start_at: "2026-09-05T10:00:00+00:00",
        end_at: null,
        all_day: false,
        tz: "Europe/Berlin",
        rrule: null,
        priority: "medium",
        channels: [],
        reminder_offsets: [],
        remind_time_of_day: null,
        repeat_until_ack: false,
        snooze_allowed: true,
        email_enabled: false,
        email_to: null,
        source: "web",
        raw_input: null,
        ai_confidence: null,
        status: "active",
        created_at: "",
        updated_at: "",
      }),
    ).toBe("Sat, Sep 5 · 12:00 PM");
  });
});
