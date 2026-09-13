import { describe, it, expect } from "vitest";
import {
  priorityStyle,
  tagStyle,
  toEventRow,
  weekInMonth,
  groupByMonth,
  paginate,
  hasMore,
  eventTimeLabel,
} from "../../src/core/timeline";
import type { EventRead } from "../../src/core/eventTypes";

function makeEvent(overrides: Partial<EventRead>): EventRead {
  return {
    id: 1,
    title: "Test",
    description: "",
    location_url: "",
    tags: [],
    type: "one_time",
    start_at: "2026-09-05T10:00:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: null,
    priority: "medium",
    channels: ["telegram"],
    reminder_offsets: [],
    remind_time_of_day: null,
    repeat_until_ack: false,
    snooze_allowed: false,
    email_enabled: false,
    email_to: null,
    source: "web",
    raw_input: null,
    ai_confidence: null,
    status: "active",
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
    ...overrides,
  };
}

describe("timeline core module", () => {
  describe("priorityStyle", () => {
    it("returns distinct styles for each priority", () => {
      expect(priorityStyle("critical").icon).toBe("!");
      expect(priorityStyle("medium").icon).toBe("•");
      expect(priorityStyle("low").icon).toBe("·");
      expect(priorityStyle("critical").color).toContain("red");
      expect(priorityStyle("medium").color).toContain("amber");
      expect(priorityStyle("low").color).toContain("slate");
    });

    it("falls back to medium for unknown priorities", () => {
      expect(priorityStyle("unknown" as EventRead["priority"])).toEqual(
        priorityStyle("medium"),
      );
    });
  });

  describe("tagStyle", () => {
    it("is deterministic for the same tag", () => {
      expect(tagStyle("work")).toEqual(tagStyle("work"));
    });

    it("may differ across tags", () => {
      const a = tagStyle("work");
      const b = tagStyle("personal");
      expect(a.icon).toBe("#");
      expect(b.icon).toBe("#");
      expect(a.color).toBeTruthy();
    });
  });

  describe("toEventRow", () => {
    it("derives priority and tag styling", () => {
      const row = toEventRow(
        makeEvent({ priority: "critical", tags: ["work"] }),
      );
      expect(row.priorityColor).toContain("red");
      expect(row.priorityIcon).toBe("!");
      expect(row.tagColor).toContain("border-");
      expect(row.tagIcon).toBe("#");
    });

    it("shows a recurrence badge for a recurring event", () => {
      const row = toEventRow(makeEvent({ rrule: "FREQ=MONTHLY;INTERVAL=3" }));
      expect(row.recurrenceBadge).toBe("every quarter");
    });

    it("hides the badge for a one-time event", () => {
      const row = toEventRow(makeEvent({ rrule: null }));
      expect(row.recurrenceBadge).toBeNull();
    });

    it("hides the badge for an unrecognised recurrence", () => {
      const row = toEventRow(makeEvent({ rrule: "FREQ=HOURLY" }));
      expect(row.recurrenceBadge).toBeNull();
    });

    it("uses a neutral tag style when there are no tags", () => {
      const row = toEventRow(makeEvent({ tags: [] }));
      expect(row.tagColor).toContain("slate");
    });
  });

  describe("eventTimeLabel", () => {
    it("formats a timed event with weekday, date and time", () => {
      const event = makeEvent({ start_at: "2026-09-05T10:00:00", all_day: false });
      expect(eventTimeLabel(event)).toBe("Sat, Sep 5 · 10:00 AM");
    });

    it("omits the time for an all-day event", () => {
      const event = makeEvent({ start_at: "2026-09-05T10:00:00", all_day: true });
      expect(eventTimeLabel(event)).toBe("Sat, Sep 5");
    });

    it("formats afternoon times with PM", () => {
      const event = makeEvent({ start_at: "2026-09-05T14:30:00", all_day: false });
      expect(eventTimeLabel(event)).toBe("Sat, Sep 5 · 2:30 PM");
    });

    it("formats midnight as 12:00 AM", () => {
      const event = makeEvent({ start_at: "2026-09-05T00:00:00", all_day: false });
      expect(eventTimeLabel(event)).toBe("Sat, Sep 5 · 12:00 AM");
    });

    it("falls back to the raw value for an unparseable start", () => {
      const event = makeEvent({ start_at: "not-a-date", all_day: false });
      expect(eventTimeLabel(event)).toBe("not-a-date");
    });
  });

  describe("weekInMonth", () => {
    it("computes week 1..5 within a month", () => {
      expect(weekInMonth(new Date(2026, 8, 1))).toBe(1);
      expect(weekInMonth(new Date(2026, 8, 7))).toBe(1);
      expect(weekInMonth(new Date(2026, 8, 8))).toBe(2);
      expect(weekInMonth(new Date(2026, 8, 22))).toBe(4);
      expect(weekInMonth(new Date(2026, 8, 30))).toBe(5);
    });
  });

  describe("groupByMonth", () => {
    it("groups events by month and week, sorted chronologically", () => {
      const events = [
        makeEvent({ id: 1, start_at: "2026-09-20T10:00:00", title: "Later" }),
        makeEvent({ id: 2, start_at: "2026-09-03T10:00:00", title: "Week 1" }),
        makeEvent({ id: 3, start_at: "2026-08-15T10:00:00", title: "Aug" }),
      ];
      const groups = groupByMonth(events);
      expect(groups.map((g) => g.key)).toEqual(["2026-08", "2026-09"]);
      expect(groups[1].label).toBe("2026-09");
      expect(groups[1].weeks.map((w) => w.key)).toEqual([
        "2026-09:1",
        "2026-09:3",
      ]);
      expect(groups[1].weeks[0].rows[0].event.title).toBe("Week 1");
      expect(groups[1].weeks[1].rows[0].event.title).toBe("Later");
    });

    it("sorts events within a week by start time", () => {
      const events = [
        makeEvent({ id: 1, start_at: "2026-09-06T18:00:00", title: "Evening" }),
        makeEvent({ id: 2, start_at: "2026-09-06T09:00:00", title: "Morning" }),
      ];
      const groups = groupByMonth(events);
      expect(groups[0].weeks[0].rows.map((r) => r.event.title)).toEqual([
        "Morning",
        "Evening",
      ]);
    });

    it("keeps events with an unparseable start in an unsorted bucket", () => {
      const events = [makeEvent({ id: 1, start_at: "not-a-date" })];
      const groups = groupByMonth(events);
      expect(groups).toHaveLength(1);
      expect(groups[0].key).toBe("unsorted");
      expect(groups[0].weeks[0].rows[0].event.id).toBe(1);
    });

    it("does not mutate the input array", () => {
      const events = [
        makeEvent({ id: 2, start_at: "2026-09-03T10:00:00" }),
        makeEvent({ id: 1, start_at: "2026-09-01T10:00:00" }),
      ];
      const before = events.map((e) => e.id);
      groupByMonth(events);
      expect(events.map((e) => e.id)).toEqual(before);
    });
  });

  describe("paginate", () => {
    const events = [1, 2, 3, 4, 5].map((id) => makeEvent({ id }));

    it("returns a cumulative slice that accumulates across pages", () => {
      expect(paginate(events, 2, 0).map((e) => e.id)).toEqual([1, 2]);
      expect(paginate(events, 2, 1).map((e) => e.id)).toEqual([1, 2, 3, 4]);
      expect(paginate(events, 2, 2).map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it("returns the full list past the end", () => {
      expect(paginate(events, 2, 99).map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it("clamps a zero page size to 1", () => {
      expect(paginate(events, 0, 0).map((e) => e.id)).toEqual([1]);
    });

    it("clamps a negative page to 0", () => {
      expect(paginate(events, 2, -3).map((e) => e.id)).toEqual([1, 2]);
    });
  });

  describe("hasMore", () => {
    const events = [1, 2, 3, 4, 5].map((id) => makeEvent({ id }));

    it("is true when more pages remain", () => {
      expect(hasMore(events, 2, 0)).toBe(true);
      expect(hasMore(events, 2, 1)).toBe(true);
    });

    it("is false on the final page", () => {
      expect(hasMore(events, 2, 2)).toBe(false);
    });

    it("is false for an empty list", () => {
      expect(hasMore([], 2, 0)).toBe(false);
    });

    it("clamps a zero page size to 1", () => {
      expect(hasMore(events, 0, 4)).toBe(false);
    });
  });
});
