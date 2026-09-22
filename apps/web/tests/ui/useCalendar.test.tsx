import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useCalendar } from "../../src/ui/viewModels/useCalendar";
import { ServicesContext, type Services } from "../../src/ui/services/context";
import type { EventOccurrence } from "../../src/core/eventTypes";

function makeOccurrence(overrides: Partial<EventOccurrence>): EventOccurrence {
  return {
    event_id: 1,
    title: "Pay HRA quarterly",
    priority: "critical",
    tag: null,
    rrule: "FREQ=MONTHLY;INTERVAL=3",
    start_at: "2026-10-01T16:00:00Z",
    all_day: false,
    tz: "America/New_York",
    next_occurrence: "2027-01-01T17:00:00Z",
    ...overrides,
  };
}

function wrapper(services: Services) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServicesContext.Provider value={services}>
        {children}
      </ServicesContext.Provider>
    );
  };
}

/** YYYY-MM key `delta` months from today (mirrors the hook's cursor math). */
function monthKeyFromToday(delta: number): string {
  const d = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + delta,
    1,
  );
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

describe("useCalendar adjacent-month fetch", () => {
  it("fetches the previous, current and next months together", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([]);
    const services = {
      apiClient: { getOccurrences },
      llmParser: {},
    } as unknown as Services;

    renderHook(() => useCalendar(), { wrapper: wrapper(services) });

    await waitFor(() => expect(getOccurrences).toHaveBeenCalledTimes(3));
    const months = getOccurrences.mock.calls.map((call) => call[0]);
    expect(months).toEqual([
      monthKeyFromToday(-1),
      monthKeyFromToday(0),
      monthKeyFromToday(1),
    ]);
  });

  it("surfaces a next-month occurrence in the agenda", async () => {
    // An occurrence 20 days out always lands in the current or next month,
    // so the merged (prev/current/next) payload covers it on any run date.
    const now = new Date();
    const future = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 20,
      12,
      0,
      0,
    );
    const startAt = new Date(
      Date.UTC(
        future.getFullYear(),
        future.getMonth(),
        future.getDate(),
        12,
        0,
        0,
      ),
    ).toISOString();
    const getOccurrences = vi.fn().mockImplementation((month: string) => {
      if (month === monthKeyFromToday(1)) {
        return Promise.resolve([makeOccurrence({ start_at: startAt })]);
      }
      return Promise.resolve([]);
    });
    const services = {
      apiClient: { getOccurrences },
      llmParser: {},
    } as unknown as Services;

    const { result } = renderHook(() => useCalendar(), {
      wrapper: wrapper(services),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(
      result.current.agenda?.some(
        (row) => row.occurrence.title === "Pay HRA quarterly",
      ) ?? false,
    ).toBe(true);
  });

  it("shows a loading error when a neighbour-month fetch fails", async () => {
    const getOccurrences = vi.fn().mockRejectedValue(new Error("boom"));
    const services = {
      apiClient: { getOccurrences },
      llmParser: {},
    } as unknown as Services;

    const { result } = renderHook(() => useCalendar(), {
      wrapper: wrapper(services),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to load occurrences");
  });
});
