import { describe, it, expect, vi, afterEach } from "vitest";
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
  weekdayForDate,
  monthShortForNumber,
  datePartsInTimezone,
  toDateInTimezone,
  toMonthInTimezone,
  parseNaiveWallClock,
  displayParts,
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

  it("returns a short weekday label for a calendar date", () => {
    expect(weekdayForDate(2026, 9, 7)).toBe("Mon");
  });
});

describe("timezone-aware formatting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty short month for out-of-range month numbers", () => {
    expect(monthShortForNumber(0)).toBe("");
    expect(monthShortForNumber(13)).toBe("");
    expect(monthShortForNumber(9)).toBe("Sep");
  });

  it("splits a Date into parts in the requested timezone", () => {
    // 2026-09-05T10:00:00Z is noon in Berlin (CEST, UTC+2) on a Saturday.
    const parts = datePartsInTimezone(
      new Date("2026-09-05T10:00:00Z"),
      "Europe/Berlin",
    );
    expect(parts).toEqual({
      year: 2026,
      month: 9,
      day: 5,
      hour: 12,
      minute: 0,
      weekday: "Sat",
      monthShort: "Sep",
    });
  });

  it("returns null for an invalid timezone", () => {
    expect(
      datePartsInTimezone(new Date("2026-09-05T10:00:00Z"), "Mars/Olympus"),
    ).toBeNull();
  });

  it("returns null when the runtime omits an expected part", () => {
    // Defensive guard for exotic ICU builds that drop parts.
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([
      { type: "year", value: "2026" },
      { type: "month", value: "9" },
      { type: "day", value: "5" },
      { type: "hour", value: "10" },
      // no "minute" part
    ]);
    expect(
      datePartsInTimezone(new Date("2026-09-05T10:00:00Z"), "UTC"),
    ).toBeNull();
  });

  it("normalizes ICU hour 24 to midnight", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([
      { type: "year", value: "2026" },
      { type: "month", value: "9" },
      { type: "day", value: "5" },
      { type: "hour", value: "24" },
      { type: "minute", value: "0" },
      { type: "weekday", value: "Sat" },
    ]);
    const parts = datePartsInTimezone(new Date("2026-09-05T00:00:00Z"), "UTC");
    expect(parts).toEqual({
      year: 2026,
      month: 9,
      day: 5,
      hour: 0,
      minute: 0,
      weekday: "Sat",
      monthShort: "Sep",
    });
  });

  it("renders an empty weekday when the runtime omits it", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([
      { type: "year", value: "2026" },
      { type: "month", value: "9" },
      { type: "day", value: "5" },
      { type: "hour", value: "12" },
      { type: "minute", value: "0" },
      // no "weekday" part
    ]);
    const parts = datePartsInTimezone(new Date("2026-09-05T10:00:00Z"), "UTC");
    expect(parts?.weekday).toBe("");
    expect(parts?.year).toBe(2026);
  });

  it("formats a date in the given timezone and falls back to local for invalid zones", () => {
    const date = new Date("2026-09-05T10:00:00Z");
    expect(toDateInTimezone(date, "UTC")).toBe("2026-09-05");
    expect(toMonthInTimezone(date, "UTC")).toBe("2026-09");
    expect(toDateInTimezone(date, "Mars/Olympus")).toBe(toLocalDate(date));
    expect(toMonthInTimezone(date, "Mars/Olympus")).toBe(
      toLocalDate(date).slice(0, 7),
    );
  });

  it("rejects out-of-range wall-clock components", () => {
    expect(parseNaiveWallClock("2026-13-05T10:00")).toBeNull();
    expect(parseNaiveWallClock("2026-00-05T10:00")).toBeNull();
    expect(parseNaiveWallClock("2026-09-32T10:00")).toBeNull();
    expect(parseNaiveWallClock("2026-09-00T10:00")).toBeNull();
    expect(parseNaiveWallClock("2026-09-05T24:00")).toBeNull();
    expect(parseNaiveWallClock("2026-09-05T10:60")).toBeNull();
    expect(parseNaiveWallClock("2026-09-05T10:00")).toEqual({
      year: 2026,
      month: 9,
      day: 5,
      hour: 10,
      minute: 0,
    });
  });

  it("falls back to browser-local parts without a timezone", () => {
    // A locally-constructed Date renders the same wall clock as the naive
    // ISO string, so the expectation holds on any machine timezone.
    const parts = displayParts("2026-09-05T10:00:00", new Date(2026, 8, 5, 10, 0));
    expect(parts).toEqual({
      year: 2026,
      month: 9,
      day: 5,
      hour: 10,
      minute: 0,
      weekday: "Sat",
      monthShort: "Sep",
    });
  });

  it("falls back to browser-local parts when the timezone is invalid", () => {
    const iso = "2026-09-05T10:00:00+00:00";
    const parsed = parseIso(iso) as Date;
    const parts = displayParts(iso, parsed, "Mars/Olympus");
    expect(parts.year).toBe(parsed.getFullYear());
    expect(parts.month).toBe(parsed.getMonth() + 1);
    expect(parts.day).toBe(parsed.getDate());
    expect(parts.hour).toBe(parsed.getHours());
    expect(parts.minute).toBe(parsed.getMinutes());
    expect(parts.weekday).toBe(weekdayShort(parsed));
    expect(parts.monthShort).toBe(
      parsed.toLocaleString("en-US", { month: "short" }),
    );
  });
});
