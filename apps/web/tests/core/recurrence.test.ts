import { describe, it, expect } from "vitest";
import {
  expandOccurrences,
  parseRrule,
  wallToUtcMs,
  EXPANSION_YEARS,
} from "../../src/core/recurrence";
import type { EventRead } from "../../src/core/eventTypes";

function makeEvent(overrides: Partial<EventRead>): EventRead {
  return {
    id: 1,
    title: "Test",
    description: "",
    location_url: "",
    tags: [],
    type: "recurrent",
    start_at: "2026-01-01T09:00:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: "FREQ=MONTHLY;INTERVAL=3",
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

/** Strip the time part for date-level assertions. */
function dates(iso: string[]): string[] {
  return iso.map((s) => s.slice(0, 10));
}

describe("recurrence expander", () => {
  describe("quarterly from January (the reported case)", () => {
    it("expands Jan/Apr/Jul/Oct for a UTC event starting 2026-01-01", () => {
      const occs = expandOccurrences(makeEvent({}));
      expect(dates(occs).slice(0, 4)).toEqual([
        "2026-01-01",
        "2026-04-01",
        "2026-07-01",
        "2026-10-01",
      ]);
      expect(occs[0]).toBe("2026-01-01T09:00:00Z");
      expect(occs[3]).toBe("2026-10-01T09:00:00Z");
    });

    it("keeps the New York wall clock (12:00) across DST", () => {
      // Backend ground truth: 17:00Z in winter (EST), 16:00Z in summer (EDT).
      const occs = expandOccurrences(
        makeEvent({
          start_at: "2026-01-01T12:00:00",
          tz: "America/New_York",
        }),
      );
      expect(dates(occs).slice(0, 6)).toEqual([
        "2026-01-01",
        "2026-04-01",
        "2026-07-01",
        "2026-10-01",
        "2027-01-01",
        "2027-04-01",
      ]);
      expect(occs.slice(0, 6)).toEqual([
        "2026-01-01T17:00:00Z",
        "2026-04-01T16:00:00Z",
        "2026-07-01T16:00:00Z",
        "2026-10-01T16:00:00Z",
        "2027-01-01T17:00:00Z",
        "2027-04-01T16:00:00Z",
      ]);
      expect(occs).toContain("2026-10-01T16:00:00Z");
    });

    it("supports the BYMONTHDAY quarterly variant", () => {
      const occs = expandOccurrences(
        makeEvent({ rrule: "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1" }),
      );
      expect(dates(occs).slice(0, 4)).toEqual([
        "2026-01-01",
        "2026-04-01",
        "2026-07-01",
        "2026-10-01",
      ]);
    });
  });

  describe("other frequencies", () => {
    it("expands daily occurrences", () => {
      const occs = expandOccurrences(
        makeEvent({ rrule: "FREQ=DAILY", start_at: "2026-01-01T10:00:00" }),
      );
      expect(dates(occs).slice(0, 3)).toEqual([
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
      ]);
    });

    it("expands weekly BYDAY lists (Mon/Wed/Fri)", () => {
      const occs = expandOccurrences(
        makeEvent({
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
          start_at: "2026-01-05T09:00:00",
        }),
      );
      expect(dates(occs).slice(0, 6)).toEqual([
        "2026-01-05",
        "2026-01-07",
        "2026-01-09",
        "2026-01-12",
        "2026-01-14",
        "2026-01-16",
      ]);
    });

    it("expands a plain weekly rule on the start weekday", () => {
      const occs = expandOccurrences(
        makeEvent({
          rrule: "FREQ=WEEKLY",
          start_at: "2026-01-05T09:00:00",
        }),
      );
      expect(dates(occs).slice(0, 3)).toEqual([
        "2026-01-05",
        "2026-01-12",
        "2026-01-19",
      ]);
    });

    it("expands monthly BYMONTHDAY", () => {
      const occs = expandOccurrences(
        makeEvent({
          rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
          start_at: "2026-01-15T10:00:00",
        }),
      );
      expect(dates(occs).slice(0, 3)).toEqual([
        "2026-01-15",
        "2026-02-15",
        "2026-03-15",
      ]);
    });

    it("expands yearly occurrences", () => {
      const occs = expandOccurrences(
        makeEvent({
          rrule: "FREQ=YEARLY",
          start_at: "2026-03-14T08:30:00",
        }),
      );
      expect(dates(occs).slice(0, 3)).toEqual([
        "2026-03-14",
        "2027-03-14",
        "2028-03-14",
      ]);
      expect(occs[0]).toBe("2026-03-14T08:30:00Z");
    });

    it("fires Feb 29 only in leap years", () => {
      const occs = expandOccurrences(
        makeEvent({
          rrule: "FREQ=YEARLY",
          start_at: "2024-02-29T10:00:00",
        }),
      );
      expect(dates(occs).slice(0, 3)).toEqual([
        "2024-02-29",
        "2028-02-29",
        "2032-02-29",
      ]);
    });
  });

  describe("month-end parity with the backend", () => {
    it("skips months lacking the day (Jan 31 quarterly skips April)", () => {
      const occs = expandOccurrences(
        makeEvent({
          rrule: "FREQ=MONTHLY;INTERVAL=3",
          start_at: "2026-01-31T10:00:00",
        }),
      );
      expect(dates(occs).slice(0, 4)).toEqual([
        "2026-01-31",
        "2026-07-31",
        "2026-10-31",
        "2027-01-31",
      ]);
    });
  });

  describe("COUNT / UNTIL", () => {
    it("honors COUNT (inclusive of the start)", () => {
      const occs = expandOccurrences(
        makeEvent({ rrule: "FREQ=DAILY;COUNT=5" }),
      );
      expect(occs).toHaveLength(5);
      expect(dates(occs)).toEqual([
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
        "2026-01-04",
        "2026-01-05",
      ]);
    });

    it("honors an inclusive UNTIL", () => {
      const occs = expandOccurrences(
        makeEvent({ rrule: "FREQ=DAILY;UNTIL=20260103T000000Z" }),
      );
      // UNTIL is midnight Jan 3; the 09:00 occurrences on Jan 1–2 qualify.
      expect(dates(occs)).toEqual(["2026-01-01", "2026-01-02"]);
    });
  });

  describe("all-day and DST", () => {
    it("anchors all-day occurrences at local midnight across DST", () => {
      const occs = expandOccurrences(
        makeEvent({
          rrule: "FREQ=DAILY",
          start_at: "2026-03-07T00:00:00",
          tz: "America/New_York",
          all_day: true,
        }),
      );
      // Backend ground truth: 05:00Z before the transition, 04:00Z after.
      expect(occs.slice(0, 3)).toEqual([
        "2026-03-07T05:00:00Z",
        "2026-03-08T05:00:00Z",
        "2026-03-09T04:00:00Z",
      ]);
    });

    it("keeps the local wall time for timed events across DST", () => {
      const occs = expandOccurrences(
        makeEvent({
          rrule: "FREQ=DAILY",
          start_at: "2026-03-07T09:30:00",
          tz: "America/New_York",
        }),
      );
      expect(occs.slice(0, 3)).toEqual([
        "2026-03-07T14:30:00Z",
        "2026-03-08T13:30:00Z",
        "2026-03-09T13:30:00Z",
      ]);
    });
  });

  describe("fallbacks (never drop an event)", () => {
    it("returns the single master start for one-time events", () => {
      const occs = expandOccurrences(
        makeEvent({ rrule: null, start_at: "2026-06-05T18:00:00" }),
      );
      expect(occs).toEqual(["2026-06-05T18:00:00Z"]);
    });

    it("falls back to the master start for unsupported rules", () => {
      for (const rrule of [
        "FREQ=HOURLY",
        "FREQ=MINUTELY",
        "NOT_A_RULE",
        "FREQ=MONTHLY;BYDAY=1MO",
        "FREQ=YEARLY;BYYEARDAY=100",
      ]) {
        expect(expandOccurrences(makeEvent({ rrule }))).toEqual([
          "2026-01-01T09:00:00Z",
        ]);
      }
    });

    it("returns the raw start when it cannot be parsed", () => {
      expect(
        expandOccurrences(makeEvent({ start_at: "not-a-date" })),
      ).toEqual(["not-a-date"]);
    });
  });

  describe("bounds", () => {
    it("expands through EXPANSION_YEARS past the start", () => {
      const occs = expandOccurrences(makeEvent({}));
      const lastYear = Number(occs[occs.length - 1].slice(0, 4));
      expect(lastYear).toBe(2026 + EXPANSION_YEARS);
    });

    it("caps rows per event so daily rules cannot flood the Timeline", () => {
      const occs = expandOccurrences(
        makeEvent({ rrule: "FREQ=DAILY", start_at: "2026-01-01T10:00:00" }),
      );
      expect(occs.length).toBeLessThanOrEqual(60);
      expect(occs[0]).toBe("2026-01-01T10:00:00Z");
    });
  });

  describe("parseRrule", () => {
    it("parses interval, count and until", () => {
      expect(parseRrule("FREQ=MONTHLY;INTERVAL=3")).toMatchObject({
        freq: "MONTHLY",
        interval: 3,
        count: null,
      });
      expect(parseRrule("freq=daily;count=5")).toMatchObject({
        freq: "DAILY",
        count: 5,
      });
    });

    it("rejects unsupported constructs", () => {
      expect(parseRrule("FREQ=HOURLY")).toBeNull();
      expect(parseRrule("garbage")).toBeNull();
      expect(parseRrule("FREQ=DAILY;BYSECOND=30")).toBeNull();
    });
  });

  describe("wallToUtcMs", () => {
    it("converts a winter New York wall time (EST, UTC-5)", () => {
      const ms = wallToUtcMs(
        { year: 2026, month: 1, day: 1, hour: 12, minute: 0, second: 0 },
        "America/New_York",
      );
      expect(ms).not.toBeNull();
      expect(new Date(ms!).toISOString()).toBe("2026-01-01T17:00:00.000Z");
    });

    it("returns null for an unknown timezone", () => {
      expect(
        wallToUtcMs(
          { year: 2026, month: 1, day: 1, hour: 12, minute: 0, second: 0 },
          "Not/AZone",
        ),
      ).toBeNull();
    });
  });
});
