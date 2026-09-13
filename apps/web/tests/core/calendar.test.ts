import { describe, it, expect } from "vitest";
import {
  monthKey,
  monthLabel,
  navigateMonth,
  monthGrid,
  dayOccurrences,
  withOccurrences,
  toOccurrenceRow,
  type CalendarDay,
} from "../../src/core/calendar";
import type { EventOccurrence } from "../../src/core/eventTypes";

function makeOccurrence(overrides: Partial<EventOccurrence>): EventOccurrence {
  return {
    event_id: 1,
    title: "Test",
    priority: "medium",
    tag: null,
    rrule: null,
    start_at: "2026-09-05T10:00:00",
    all_day: false,
    tz: "UTC",
    next_occurrence: null,
    ...overrides,
  };
}

/** Find a day cell in a grid by its local ISO date. */
function dayByIso(grid: ReturnType<typeof monthGrid>, isoDate: string): CalendarDay {
  for (const week of grid.weeks) {
    const found = week.days.find((d) => d.isoDate === isoDate);
    if (found) return found;
  }
  throw new Error(`day ${isoDate} not in grid`);
}

describe("calendar core module", () => {
  describe("monthKey", () => {
    it("formats a YYYY-MM key with zero padding", () => {
      expect(monthKey(2026, 9)).toBe("2026-09");
      expect(monthKey(2026, 12)).toBe("2026-12");
      expect(monthKey(2026, 1)).toBe("2026-01");
    });
  });

  describe("monthLabel", () => {
    it("formats a full human month label", () => {
      expect(monthLabel(2026, 9)).toBe("September 2026");
      expect(monthLabel(2026, 1)).toBe("January 2026");
      expect(monthLabel(2025, 12)).toBe("December 2025");
    });
  });

  describe("navigateMonth", () => {
    it("moves forward within the same year", () => {
      expect(navigateMonth(2026, 9, 1)).toEqual({ year: 2026, month: 10 });
    });

    it("moves backward within the same year", () => {
      expect(navigateMonth(2026, 9, -1)).toEqual({ year: 2026, month: 8 });
    });

    it("rolls over into the next year", () => {
      expect(navigateMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    });

    it("rolls back into the previous year", () => {
      expect(navigateMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    });

    it("handles multi-month jumps across years", () => {
      expect(navigateMonth(2026, 11, 3)).toEqual({ year: 2027, month: 2 });
      expect(navigateMonth(2026, 2, -3)).toEqual({ year: 2025, month: 11 });
    });

    it("is a no-op for a zero delta", () => {
      expect(navigateMonth(2026, 9, 0)).toEqual({ year: 2026, month: 9 });
    });

    it("truncates fractional deltas", () => {
      expect(navigateMonth(2026, 9, 1.9)).toEqual({ year: 2026, month: 10 });
    });
  });

  describe("monthGrid", () => {
    it("produces full Sunday-first weeks covering the month", () => {
      // September 2026: 1st is a Tuesday. The grid must start on the Sunday
      // before (Aug 30) and end on the Saturday on/after the last day.
      const grid = monthGrid(2026, 9);
      expect(grid.year).toBe(2026);
      expect(grid.month).toBe(9);

      const firstWeek = grid.weeks[0];
      expect(firstWeek.days[0].isoDate).toBe("2026-08-30");
      expect(firstWeek.days[0].inMonth).toBe(false);
      expect(firstWeek.days[0].dayOfMonth).toBe(30);

      const lastWeek = grid.weeks[grid.weeks.length - 1];
      expect(lastWeek.days[6].isoDate).toBe("2026-10-03");
      expect(lastWeek.days[6].inMonth).toBe(false);
    });

    it("marks in-month days and excludes them from filler", () => {
      const grid = monthGrid(2026, 9);
      const first = dayByIso(grid, "2026-09-01");
      expect(first.inMonth).toBe(true);
      expect(first.dayOfMonth).toBe(1);
      const last = dayByIso(grid, "2026-09-30");
      expect(last.inMonth).toBe(true);
      expect(last.dayOfMonth).toBe(30);
    });

    it("each week has exactly 7 days", () => {
      const grid = monthGrid(2026, 9);
      for (const week of grid.weeks) {
        expect(week.days).toHaveLength(7);
      }
    });

    it("covers a month that starts on a Sunday with no leading filler", () => {
      // March 2026: the 1st is a Sunday.
      const grid = monthGrid(2026, 3);
      expect(grid.weeks[0].days[0].isoDate).toBe("2026-03-01");
      expect(grid.weeks[0].days[0].inMonth).toBe(true);
    });

    it("handles February in a leap year", () => {
      const grid = monthGrid(2024, 2);
      const last = dayByIso(grid, "2024-02-29");
      expect(last.inMonth).toBe(true);
      expect(last.dayOfMonth).toBe(29);
    });

    it("starts each day cell empty", () => {
      const grid = monthGrid(2026, 9);
      expect(dayByIso(grid, "2026-09-05").occurrences).toEqual([]);
      expect(dayByIso(grid, "2026-09-05").count).toBe(0);
    });

    it("throws for an out-of-range month", () => {
      expect(() => monthGrid(2026, 0)).toThrow(RangeError);
      expect(() => monthGrid(2026, 13)).toThrow(RangeError);
    });
  });

  describe("dayOccurrences", () => {
    it("filters occurrences for the matching local day", () => {
      const grid = monthGrid(2026, 9);
      const day = dayByIso(grid, "2026-09-05");
      const occurrences = [
        makeOccurrence({ event_id: 1, start_at: "2026-09-05T10:00:00" }),
        makeOccurrence({ event_id: 2, start_at: "2026-09-06T10:00:00" }),
      ];
      const result = dayOccurrences(occurrences, day);
      expect(result.map((o) => o.event_id)).toEqual([1]);
    });

    it("returns an empty list when no occurrence falls on the day", () => {
      const grid = monthGrid(2026, 9);
      const day = dayByIso(grid, "2026-09-10");
      const result = dayOccurrences(
        [makeOccurrence({ event_id: 1, start_at: "2026-09-05T10:00:00" })],
        day,
      );
      expect(result).toEqual([]);
    });

    it("drops occurrences with an unparseable start", () => {
      const grid = monthGrid(2026, 9);
      const day = dayByIso(grid, "2026-09-05");
      const result = dayOccurrences(
        [makeOccurrence({ event_id: 1, start_at: "not-a-date" })],
        day,
      );
      expect(result).toEqual([]);
    });
  });

  describe("withOccurrences", () => {
    it("fills each day's occurrences and count from the payload", () => {
      const grid = monthGrid(2026, 9);
      const occurrences = [
        makeOccurrence({ event_id: 1, start_at: "2026-09-05T10:00:00" }),
        makeOccurrence({ event_id: 2, start_at: "2026-09-05T14:00:00" }),
        makeOccurrence({ event_id: 3, start_at: "2026-09-20T09:00:00" }),
      ];
      const filled = withOccurrences(grid, occurrences);
      expect(dayByIso(filled, "2026-09-05").count).toBe(2);
      expect(dayByIso(filled, "2026-09-05").occurrences).toHaveLength(2);
      expect(dayByIso(filled, "2026-09-20").count).toBe(1);
      expect(dayByIso(filled, "2026-09-10").count).toBe(0);
    });

    it("places occurrences on adjacent-month filler days too", () => {
      const grid = monthGrid(2026, 9);
      const occurrences = [
        makeOccurrence({ event_id: 1, start_at: "2026-08-30T10:00:00" }),
      ];
      const filled = withOccurrences(grid, occurrences);
      const filler = dayByIso(filled, "2026-08-30");
      expect(filler.inMonth).toBe(false);
      expect(filler.count).toBe(1);
    });

    it("does not mutate the input grid", () => {
      const grid = monthGrid(2026, 9);
      const before = dayByIso(grid, "2026-09-05").count;
      withOccurrences(grid, [
        makeOccurrence({ event_id: 1, start_at: "2026-09-05T10:00:00" }),
      ]);
      expect(dayByIso(grid, "2026-09-05").count).toBe(before);
    });

    it("drops occurrences with an unparseable start", () => {
      const grid = monthGrid(2026, 9);
      const filled = withOccurrences(
        grid,
        [makeOccurrence({ event_id: 1, start_at: "not-a-date" })],
      );
      expect(dayByIso(filled, "2026-09-05").count).toBe(0);
    });
  });

  describe("toOccurrenceRow", () => {
    it("derives priority, tag, time and recurrence styling", () => {
      const row = toOccurrenceRow(
        makeOccurrence({
          priority: "critical",
          tag: "health",
          rrule: "FREQ=MONTHLY;INTERVAL=3",
          start_at: "2026-09-05T10:00:00",
          next_occurrence: "2026-12-05T10:00:00",
        }),
      );
      expect(row.priorityColor).toContain("red");
      expect(row.priorityIcon).toBe("!");
      expect(row.tagColor).toContain("border-");
      expect(row.tagIcon).toBe("#");
      expect(row.recurrenceBadge).toBe("every quarter");
      expect(row.timeLabel).toBe("Sat, Sep 5 · 10:00 AM");
      expect(row.nextOccurrenceLabel).toBe("Next: Sat, Dec 5");
    });

    it("formats an all-day occurrence without a time", () => {
      const row = toOccurrenceRow(
        makeOccurrence({ start_at: "2026-09-05T00:00:00", all_day: true }),
      );
      expect(row.timeLabel).toBe("Sat, Sep 5");
    });

    it("formats midnight as 12:00 AM", () => {
      const row = toOccurrenceRow(
        makeOccurrence({ start_at: "2026-09-05T00:00:00", all_day: false }),
      );
      expect(row.timeLabel).toBe("Sat, Sep 5 · 12:00 AM");
    });

    it("formats an afternoon occurrence with PM", () => {
      const row = toOccurrenceRow(
        makeOccurrence({ start_at: "2026-09-05T14:30:00", all_day: false }),
      );
      expect(row.timeLabel).toBe("Sat, Sep 5 · 2:30 PM");
    });

    it("hides the recurrence badge for a one-time occurrence", () => {
      const row = toOccurrenceRow(makeOccurrence({ rrule: null }));
      expect(row.recurrenceBadge).toBeNull();
    });

    it("uses a neutral tag style when there is no tag", () => {
      const row = toOccurrenceRow(makeOccurrence({ tag: null }));
      expect(row.tagColor).toContain("slate");
    });

    it("hides the next-occurrence hint when none is available", () => {
      const row = toOccurrenceRow(makeOccurrence({ next_occurrence: null }));
      expect(row.nextOccurrenceLabel).toBeNull();
    });

    it("falls back to the raw value for unparseable timestamps", () => {
      const row = toOccurrenceRow(
        makeOccurrence({ start_at: "not-a-date", next_occurrence: "also-bad" }),
      );
      expect(row.timeLabel).toBe("not-a-date");
      expect(row.nextOccurrenceLabel).toBe("also-bad");
    });
  });
});
