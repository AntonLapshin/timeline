import { describe, it, expect } from "vitest";
import {
  PRIORITY_ORDER,
  monthlyCounts,
  nextSevenDays,
  isCurrentMonth,
  toPriorityCounts,
  emptyPriorityCounts,
  summaryBar,
} from "../../src/core/summaryCounts";
import type { SummaryResponse } from "../../src/core/eventTypes";

function summary(overrides: Partial<SummaryResponse> = {}): SummaryResponse {
  return {
    month: "2026-09",
    total: 12,
    by_priority: { critical: 2, medium: 5, low: 5 },
    ...overrides,
  };
}

describe("summaryCounts core module", () => {
  it("exposes priorities in canonical order", () => {
    expect(PRIORITY_ORDER).toEqual(["critical", "medium", "low"]);
  });

  it("builds a zeroed priority counts object", () => {
    expect(emptyPriorityCounts()).toEqual({ critical: 0, medium: 0, low: 0 });
  });

  it("normalizes a by_priority map into full counts", () => {
    const counts = toPriorityCounts({ critical: 1, low: 3 });
    expect(counts).toEqual({ critical: 1, medium: 0, low: 3 });
  });

  it("defaults missing and invalid priority values to 0", () => {
    const counts = toPriorityCounts({ critical: -5, bogus: 9 });
    expect(counts).toEqual({ critical: 0, medium: 0, low: 0 });
  });

  it("derives monthly counts from a summary payload", () => {
    const counts = monthlyCounts(summary());
    expect(counts.month).toBe("2026-09");
    expect(counts.total).toBe(12);
    expect(counts.byPriority).toEqual({ critical: 2, medium: 5, low: 5 });
  });

  it("clamps a negative summary total to 0", () => {
    const counts = monthlyCounts(summary({ total: -3 }));
    expect(counts.total).toBe(0);
  });

  it("detects the current month", () => {
    const today = new Date(2026, 8, 15); // September 2026
    expect(isCurrentMonth("2026-09", today)).toBe(true);
    expect(isCurrentMonth("2026-08", today)).toBe(false);
  });

  it("derives next-7-days counts for the current month", () => {
    const today = new Date(2026, 8, 15); // day 15 -> 14 elapsed days, capped at 12
    const result = nextSevenDays(summary(), today);
    expect(result.total).toBe(12);
    expect(result.overdue).toBe(12);
    expect(result.hasOverdue).toBe(true);
  });

  it("has no overdue on the first day of the month", () => {
    const today = new Date(2026, 8, 1);
    const result = nextSevenDays(summary(), today);
    expect(result.total).toBe(12);
    expect(result.overdue).toBe(0);
    expect(result.hasOverdue).toBe(false);
  });

  it("caps overdue at the total", () => {
    const today = new Date(2026, 8, 30); // 29 elapsed, but only 12 events
    const result = nextSevenDays(summary(), today);
    expect(result.overdue).toBe(12);
    expect(result.hasOverdue).toBe(true);
  });

  it("returns zero counts when the summary month is not current", () => {
    const today = new Date(2026, 8, 15);
    const result = nextSevenDays(summary({ month: "2026-08" }), today);
    expect(result).toEqual({ total: 0, overdue: 0, hasOverdue: false });
  });

  it("combines monthly and next-7-days into a summary bar model", () => {
    const today = new Date(2026, 8, 15);
    const model = summaryBar(summary(), today);
    expect(model.monthly).toEqual(monthlyCounts(summary()));
    expect(model.nextSevenDays).toEqual(nextSevenDays(summary(), today));
  });

  it("summary bar reflects an empty/zero summary cleanly", () => {
    const today = new Date(2026, 8, 1);
    const model = summaryBar(
      summary({ total: 0, by_priority: {} }),
      today,
    );
    expect(model.monthly.total).toBe(0);
    expect(model.monthly.byPriority).toEqual({
      critical: 0,
      medium: 0,
      low: 0,
    });
    expect(model.nextSevenDays).toEqual({
      total: 0,
      overdue: 0,
      hasOverdue: false,
    });
  });
});
