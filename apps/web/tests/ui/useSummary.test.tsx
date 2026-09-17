import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSummary } from "../../src/ui/viewModels/useSummary";
import type { SummaryResponse } from "../../src/core/eventTypes";

// Mock the injected services so the view model's I/O is deterministic.
const { useServicesMock } = vi.hoisted(() => ({
  useServicesMock: vi.fn(),
}));
vi.mock("../../src/ui/services/useServices", () => ({
  useServices: useServicesMock,
}));

function summaryResponse(): SummaryResponse {
  return {
    month: "2026-09",
    total: 3,
    by_priority: { critical: 1, medium: 1, low: 1 },
  };
}

describe("useSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the current month's summary on mount", async () => {
    const getSummary = vi.fn().mockResolvedValue(summaryResponse());
    useServicesMock.mockReturnValue({
      apiClient: { getSummary },
      llmParser: {},
    });

    const { result } = renderHook(() => useSummary());

    await waitFor(() => expect(result.current.loading).toBe(false));
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    expect(getSummary).toHaveBeenCalledWith(month);
    expect(result.current.summary).toEqual(summaryResponse());
    expect(result.current.error).toBeNull();
    expect(result.current.model).not.toBeNull();
  });

  it("refetches when the refreshKey changes (post-save refresh)", async () => {
    const getSummary = vi.fn().mockResolvedValue(summaryResponse());
    useServicesMock.mockReturnValue({
      apiClient: { getSummary },
      llmParser: {},
    });

    const { rerender } = renderHook(({ refreshKey }) => useSummary(refreshKey), {
      initialProps: { refreshKey: 0 },
    });
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(1));

    // Bumping the refresh key (e.g. after a wizard save, issue #121) re-runs
    // the fetch without a reload.
    rerender({ refreshKey: 1 });
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
    expect(getSummary).toHaveBeenCalledWith("2026-09");
  });

  it("shows an error when the fetch fails", async () => {
    const getSummary = vi.fn().mockRejectedValue(new Error("boom"));
    useServicesMock.mockReturnValue({
      apiClient: { getSummary },
      llmParser: {},
    });

    const { result } = renderHook(() => useSummary());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to load summary");
    expect(result.current.summary).toBeNull();
  });

  it("ignores a stale response after the refreshKey changes", async () => {
    const stale: SummaryResponse = {
      month: "2026-09",
      total: 1,
      by_priority: { critical: 1 },
    };
    const fresh = summaryResponse();
    let resolveStale!: (v: SummaryResponse) => void;
    const getSummary = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<SummaryResponse>((r) => (resolveStale = r)),
      )
      .mockResolvedValue(fresh);
    useServicesMock.mockReturnValue({
      apiClient: { getSummary },
      llmParser: {},
    });

    const { result, rerender } = renderHook(
      ({ refreshKey }) => useSummary(refreshKey),
      { initialProps: { refreshKey: 0 } },
    );
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(1));

    // Bump the refresh key while the first request is still in flight; the
    // fresh fetch resolves first.
    rerender({ refreshKey: 1 });
    await waitFor(() => expect(result.current.summary).toEqual(fresh));

    // The stale (first) response lands afterwards and must be ignored.
    act(() => resolveStale(stale));
    expect(result.current.summary).toEqual(fresh);
    expect(result.current.loading).toBe(false);
  });
});
