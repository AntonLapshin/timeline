import { describe, it, expect } from "vitest";
import {
  monthKey,
  monthLabel,
  navigateMonth,
  monthGrid,
  dayOccurrences,
  withOccurrences,
  toOccurrenceRow,
  weekStart,
  weekDays,
  weekLabel,
  weekGrid,
  navigateWeek,
  withWeekOccurrences,
  daySlots,
  timeLabel,
  priorityDotClass,
  upcomingAgenda,
  toAgendaRow,
  type CalendarDay,
} from "../../src/core/calendar";
import { toLocalDate } from "../../src/core/dateFmt";
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
  describe("priorityDotClass", () => {
    it("colors each supported priority", () => {
      expect(priorityDotClass("critical")).toContain("red");
      expect(priorityDotClass("medium")).toContain("amber");
      expect(priorityDotClass("low")).toContain("sky");
    });

    it("falls back to medium for an unrecognized priority", () => {
      expect(priorityDotClass("spam" as "medium")).toBe(
        priorityDotClass("medium"),
      );
    });
  });

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

    it("filters occurrences that lack a timezone", () => {
      const grid = monthGrid(2026, 9);
      const day = dayByIso(grid, "2026-09-05");
      const result = dayOccurrences(
        [makeOccurrence({ event_id: 1, start_at: "2026-09-05T10:00:00", tz: "" })],
        day,
      );
      expect(result.map((o) => o.event_id)).toEqual([1]);
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

    it("places occurrences that lack a timezone", () => {
      const grid = monthGrid(2026, 9);
      const filled = withOccurrences(grid, [
        makeOccurrence({ event_id: 1, start_at: "2026-09-05T10:00:00", tz: "" }),
      ]);
      expect(dayByIso(filled, "2026-09-05").count).toBe(1);
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
      expect(row.priorityIcon).toBe("");
      expect(row.tagColor).toContain("border-");
      expect(row.tagIcon).toBe("#");
      expect(row.recurrenceBadge).toBe("every quarter");
      expect(row.timeLabel).toBe("Sat, Sep 5 · 10:00 AM");
      expect(row.nextOccurrenceLabel).toBe("Next: Sat, Dec 5");
    });

    it("derives styling for an occurrence without a timezone", () => {
      const row = toOccurrenceRow(
        makeOccurrence({
          start_at: "2026-09-05T10:00:00",
          tz: "",
          next_occurrence: "2026-12-05T10:00:00",
        }),
      );
      expect(row.timeLabel).toMatch(/10:00 AM/);
      expect(row.nextOccurrenceLabel).toMatch(/Next:/);
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

    it("derives a humanized relative label for the occurrence start", () => {
      const row = toOccurrenceRow(makeOccurrence({ start_at: "2026-09-05T10:00:00" }));
      expect(row.relativeLabel).toBeTypeOf("string");
    });

    it("yields a null relative label for an unparseable start", () => {
      const row = toOccurrenceRow(makeOccurrence({ start_at: "not-a-date" }));
      expect(row.relativeLabel).toBeNull();
    });
  });

  describe("weekStart", () => {
    it("returns the Sunday that starts the week", () => {
      // 2026-09-05 is a Saturday; the week started on Sunday 2026-08-30.
      const start = weekStart(new Date(2026, 8, 5));
      expect(toLocalDate(start)).toBe("2026-08-30");
    });

    it("returns the day itself when it is a Sunday", () => {
      const start = weekStart(new Date(2026, 8, 6));
      expect(toLocalDate(start)).toBe("2026-09-06");
    });

    it("normalizes to local midnight", () => {
      const start = weekStart(new Date(2026, 8, 5, 14, 30));
      expect(start.getHours()).toBe(0);
    });
  });

  describe("weekDays", () => {
    it("produces 7 consecutive Sunday-first day cells", () => {
      const days = weekDays(new Date(2026, 8, 6));
      expect(days).toHaveLength(7);
      expect(days.map((d) => d.isoDate)).toEqual([
        "2026-09-06",
        "2026-09-07",
        "2026-09-08",
        "2026-09-09",
        "2026-09-10",
        "2026-09-11",
        "2026-09-12",
      ]);
    });

    it("starts each day cell empty", () => {
      const days = weekDays(new Date(2026, 8, 6));
      for (const d of days) {
        expect(d.occurrences).toEqual([]);
        expect(d.count).toBe(0);
      }
    });
  });

  describe("weekLabel", () => {
    it("labels a week within one year", () => {
      expect(weekLabel(new Date(2026, 8, 6))).toBe("Sep 6 – Sep 12, 2026");
    });

    it("labels a week that crosses a year boundary", () => {
      // Week starting Sunday 2026-12-27 ends Saturday 2027-01-02.
      expect(weekLabel(new Date(2026, 11, 27))).toBe(
        "Dec 27, 2026 – Jan 2, 2027",
      );
    });
  });

  describe("weekGrid", () => {
    it("builds a week grid with key, start, label and 7 days", () => {
      const week = weekGrid(new Date(2026, 8, 6));
      expect(week.key).toBe("2026-09-06");
      expect(toLocalDate(week.start)).toBe("2026-09-06");
      expect(week.label).toBe("Sep 6 – Sep 12, 2026");
      expect(week.days).toHaveLength(7);
    });
  });

  describe("navigateWeek", () => {
    it("moves forward by a week", () => {
      const next = navigateWeek(new Date(2026, 8, 6), 1);
      expect(toLocalDate(next)).toBe("2026-09-13");
    });

    it("moves backward by a week", () => {
      const prev = navigateWeek(new Date(2026, 8, 6), -1);
      expect(toLocalDate(prev)).toBe("2026-08-30");
    });

    it("is a no-op for a zero delta", () => {
      const same = navigateWeek(new Date(2026, 8, 6), 0);
      expect(toLocalDate(same)).toBe("2026-09-06");
    });
  });

  describe("withWeekOccurrences", () => {
    it("fills each day column from the payload", () => {
      const week = weekGrid(new Date(2026, 8, 6));
      const filled = withWeekOccurrences(week, [
        makeOccurrence({ event_id: 1, start_at: "2026-09-07T10:00:00" }),
        makeOccurrence({ event_id: 2, start_at: "2026-09-07T14:00:00" }),
        makeOccurrence({ event_id: 3, start_at: "2026-09-12T09:00:00" }),
      ]);
      const mon = filled.days.find((d) => d.isoDate === "2026-09-07")!;
      const sat = filled.days.find((d) => d.isoDate === "2026-09-12")!;
      const sun = filled.days.find((d) => d.isoDate === "2026-09-06")!;
      expect(mon.count).toBe(2);
      expect(mon.occurrences).toHaveLength(2);
      expect(sat.count).toBe(1);
      expect(sun.count).toBe(0);
    });

    it("does not mutate the input week grid", () => {
      const week = weekGrid(new Date(2026, 8, 6));
      withWeekOccurrences(week, [
        makeOccurrence({ event_id: 1, start_at: "2026-09-07T10:00:00" }),
      ]);
      expect(week.days[1].count).toBe(0);
    });

    it("drops occurrences with an unparseable start", () => {
      const week = weekGrid(new Date(2026, 8, 6));
      const filled = withWeekOccurrences(week, [
        makeOccurrence({ event_id: 1, start_at: "not-a-date" }),
      ]);
      expect(filled.days[1].count).toBe(0);
    });
  });

  describe("daySlots", () => {
    it("splits all-day and timed occurrences, sorted by start", () => {
      const day: CalendarDay = {
        date: new Date(2026, 8, 7),
        isoDate: "2026-09-07",
        dayOfMonth: 7,
        inMonth: true,
        occurrences: [
          makeOccurrence({ event_id: 1, start_at: "2026-09-07T14:00:00", all_day: false }),
          makeOccurrence({ event_id: 2, start_at: "2026-09-07T00:00:00", all_day: true }),
          makeOccurrence({ event_id: 3, start_at: "2026-09-07T09:00:00", all_day: false }),
        ],
        count: 3,
      };
      const { allDay, timed } = daySlots(day);
      expect(allDay.map((o) => o.event_id)).toEqual([2]);
      expect(timed.map((o) => o.event_id)).toEqual([3, 1]);
    });

    it("handles a day with no occurrences", () => {
      const day: CalendarDay = {
        date: new Date(2026, 8, 7),
        isoDate: "2026-09-07",
        dayOfMonth: 7,
        inMonth: true,
        occurrences: [],
        count: 0,
      };
      const { allDay, timed } = daySlots(day);
      expect(allDay).toEqual([]);
      expect(timed).toEqual([]);
    });
  });

  describe("timeLabel", () => {
    it("formats a morning time", () => {
      expect(timeLabel(makeOccurrence({ start_at: "2026-09-07T09:00:00" }))).toBe(
        "9:00 AM",
      );
    });

    it("formats an afternoon time", () => {
      expect(timeLabel(makeOccurrence({ start_at: "2026-09-07T14:30:00" }))).toBe(
        "2:30 PM",
      );
    });

    it("formats midnight as 12:00 AM", () => {
      expect(timeLabel(makeOccurrence({ start_at: "2026-09-07T00:00:00" }))).toBe(
        "12:00 AM",
      );
    });

    it("returns an empty string for an unparseable start", () => {
      expect(timeLabel(makeOccurrence({ start_at: "not-a-date" }))).toBe("");
    });

    it("formats a time for an occurrence without a timezone", () => {
      expect(
        timeLabel(makeOccurrence({ start_at: "2026-09-05T10:00:00", tz: "" })),
      ).toBe("10:00 AM");
    });
  });

  describe("upcomingAgenda", () => {
    it("lists future occurrences chronologically with derived rows", () => {
      const now = new Date(2026, 8, 5, 12, 0, 0);
      const rows = upcomingAgenda(
        [
          makeOccurrence({
            event_id: 1,
            title: "Later",
            priority: "critical",
            start_at: "2026-09-07T10:00:00",
            tag: "health",
            rrule: "FREQ=MONTHLY;INTERVAL=3",
          }),
          makeOccurrence({
            event_id: 2,
            title: "Sooner",
            start_at: "2026-09-06T09:00:00",
          }),
        ],
        now,
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].occurrence.title).toBe("Sooner");
      expect(rows[1].occurrence.title).toBe("Later");
      expect(rows[1].dateLabel).toBe("Mon, Sep 7");
      expect(rows[1].timeLabel).toBe("10:00 AM");
      expect(rows[1].priorityColor).toContain("red");
      expect(rows[1].priorityIcon).toBe("");
      expect(rows[1].tagColor).toContain("border-");
      expect(rows[1].tagIcon).toBe("#");
      expect(rows[1].recurrenceBadge).toBe("every quarter");
    });

    it("excludes occurrences before now", () => {
      const now = new Date(2026, 8, 5, 12, 0, 0);
      const rows = upcomingAgenda(
        [
          makeOccurrence({ event_id: 1, start_at: "2026-09-05T10:00:00" }),
          makeOccurrence({ event_id: 2, start_at: "2026-09-06T10:00:00" }),
        ],
        now,
      );
      expect(rows.map((r) => r.occurrence.event_id)).toEqual([2]);
    });

    it("includes an occurrence exactly at now", () => {
      const now = new Date(2026, 8, 5, 12, 0, 0);
      const rows = upcomingAgenda(
        [makeOccurrence({ event_id: 1, start_at: "2026-09-05T12:00:00" })],
        now,
      );
      expect(rows).toHaveLength(1);
    });

    it("returns an empty list for no future events (empty state)", () => {
      const now = new Date(2026, 8, 5, 12, 0, 0);
      const rows = upcomingAgenda(
        [makeOccurrence({ event_id: 1, start_at: "2026-09-04T10:00:00" })],
        now,
      );
      expect(rows).toEqual([]);
    });

    it("drops occurrences with an unparseable start", () => {
      const now = new Date(2026, 8, 5, 12, 0, 0);
      const rows = upcomingAgenda(
        [makeOccurrence({ event_id: 1, start_at: "not-a-date" })],
        now,
      );
      expect(rows).toEqual([]);
    });

    it("labels an all-day occurrence as All day", () => {
      const now = new Date(2026, 8, 5, 12, 0, 0);
      const rows = upcomingAgenda(
        [
          makeOccurrence({ event_id: 1, start_at: "2026-09-06T00:00:00", all_day: true }),
        ],
        now,
      );
      expect(rows[0].timeLabel).toBe("All day");
    });

    it("hides the recurrence badge for a one-time occurrence", () => {
      const now = new Date(2026, 8, 5, 12, 0, 0);
      const rows = upcomingAgenda(
        [makeOccurrence({ event_id: 1, start_at: "2026-09-06T10:00:00", rrule: null })],
        now,
      );
      expect(rows[0].recurrenceBadge).toBeNull();
    });

    it("falls back to the raw start for an unparseable date label", () => {
      const now = new Date(2026, 8, 5, 12, 0, 0);
      const rows = upcomingAgenda(
        [
          makeOccurrence({
            event_id: 1,
            start_at: "2026-09-06T10:00:00",
            all_day: true,
          }),
        ],
        now,
      );
      expect(rows[0].dateLabel).toBe("Sun, Sep 6");
    });
  });

  describe("toAgendaRow", () => {
    it("falls back to the raw start for an unparseable date label", () => {
      const row = toAgendaRow(makeOccurrence({ start_at: "not-a-date" }));
      expect(row.dateLabel).toBe("not-a-date");
    });

    it("derives a humanized relative label for the occurrence start", () => {
      const row = toAgendaRow(makeOccurrence({ start_at: "2026-09-05T10:00:00" }));
      expect(row.relativeLabel).toBeTypeOf("string");
    });

    it("derives agenda fields for an occurrence without a timezone", () => {
      const row = toAgendaRow(
        makeOccurrence({ start_at: "2026-09-05T10:00:00", tz: "" }),
      );
      expect(row.dateLabel).toBe("Sat, Sep 5");
      expect(row.timeLabel).toBe("10:00 AM");
      expect(row.relativeLabel).toBeTypeOf("string");
    });
  });
});
