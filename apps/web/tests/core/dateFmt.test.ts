import { describe, it, expect } from "vitest";
import {
  parseIso,
  toLocalDate,
  toIsoLocal,
  startOfDay,
  daysBetween,
  humanizeRelative,
  relativeLabel,
  monthLabel,
  weekdayShort,
} from "../../src/core/dateFmt";

describe("dateFmt core module", () => {
  it("parses a valid ISO string into a Date", () => {
    const date = parseIso("2026-09-20T10:00:00");
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
  });

  it("returns null for an invalid ISO string", () => {
    expect(parseIso("not-a-date")).toBeNull();
  });

  it("formats a local date as YYYY-MM-DD", () => {
    expect(toLocalDate(new Date(2026, 8, 5))).toBe("2026-09-05");
  });

  it("formats a local date as an ISO timestamp", () => {
    expect(toIsoLocal(new Date(2026, 8, 5, 9, 7, 3))).toBe("2026-09-05T09:07:03");
  });

  it("computes start of day at local midnight", () => {
    const date = startOfDay(new Date(2026, 8, 5, 14, 30));
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
    expect(toLocalDate(date)).toBe("2026-09-05");
  });

  it("computes whole-day differences", () => {
    const a = new Date(2026, 8, 10);
    const b = new Date(2026, 8, 5);
    expect(daysBetween(a, b)).toBe(5);
    expect(daysBetween(b, a)).toBe(-5);
  });

  it("humanizes today, tomorrow and yesterday", () => {
    const now = new Date(2026, 8, 10, 12, 0);
    expect(humanizeRelative(new Date(2026, 8, 10, 8, 0), now)).toBe("today");
    expect(humanizeRelative(new Date(2026, 8, 11, 8, 0), now)).toBe("tomorrow");
    expect(humanizeRelative(new Date(2026, 8, 9, 8, 0), now)).toBe("yesterday");
  });

  it("humanizes in days", () => {
    const now = new Date(2026, 8, 10, 12, 0);
    expect(humanizeRelative(new Date(2026, 8, 13, 8, 0), now)).toBe("in 3 days");
    expect(humanizeRelative(new Date(2026, 8, 8, 8, 0), now)).toBe("2 days ago");
  });

  it("humanizes in weeks", () => {
    const now = new Date(2026, 8, 10, 12, 0);
    expect(humanizeRelative(new Date(2026, 8, 31, 8, 0), now)).toBe("in 3 weeks");
    expect(humanizeRelative(new Date(2026, 7, 20, 8, 0), now)).toBe("3 weeks ago");
    expect(humanizeRelative(new Date(2026, 8, 17, 8, 0), now)).toBe("in 1 week");
    expect(humanizeRelative(new Date(2026, 8, 3, 8, 0), now)).toBe("1 week ago");
  });

  it("humanizes in years for large gaps", () => {
    const now = new Date(2026, 8, 10, 12, 0);
    expect(humanizeRelative(new Date(2029, 8, 10, 8, 0), now)).toBe("in 3 years");
    expect(humanizeRelative(new Date(2023, 8, 10, 8, 0), now)).toBe("3 years ago");
    expect(humanizeRelative(new Date(2027, 8, 10, 8, 0), now)).toBe("in 1 year");
    expect(humanizeRelative(new Date(2025, 8, 10, 8, 0), now)).toBe("1 year ago");
  });

  it("humanizes a single week", () => {
    const now = new Date(2026, 8, 10, 12, 0);
    expect(humanizeRelative(new Date(2026, 8, 24, 8, 0), now)).toBe("in 2 weeks");
  });

  it("derives a short relative label from an ISO string", () => {
    const now = new Date(2026, 8, 10, 12, 0);
    expect(relativeLabel("2026-09-10T08:00:00", now)).toBe("today");
    expect(relativeLabel("2026-09-11T08:00:00", now)).toBe("tomorrow");
    expect(relativeLabel("2026-10-01T08:00:00", now)).toBe("in 3 weeks");
    expect(relativeLabel("2026-09-07T08:00:00", now)).toBe("3 days ago");
  });

  it("returns null for an unparseable relative label input", () => {
    expect(relativeLabel("not-a-date", new Date(2026, 8, 10))).toBeNull();
  });

  it("builds full and short month labels", () => {
    expect(monthLabel("2026-09")).toEqual({
      full: "September 2026",
      short: "Sep 2026",
    });
    expect(monthLabel("2026-01")).toEqual({
      full: "January 2026",
      short: "Jan 2026",
    });
  });

  it("passes through an invalid month string", () => {
    expect(monthLabel("garbage")).toEqual({ full: "garbage", short: "garbage" });
    expect(monthLabel("2026-13")).toEqual({ full: "2026-13", short: "2026-13" });
  });

  it("returns a short weekday label", () => {
    // 2026-09-07 is a Monday.
    expect(weekdayShort(new Date(2026, 8, 7))).toBe("Mon");
  });
});
