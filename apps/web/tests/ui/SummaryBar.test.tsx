import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SummaryBar } from "../../src/ui/components/SummaryBar";
import { ServicesContext, type Services } from "../../src/ui/services/context";
import { monthKey } from "../../src/core/calendar";
import type { SummaryResponse } from "../../src/core/eventTypes";

function renderWithServices(services: Services, ui: ReactNode) {
  return render(
    <ServicesContext.Provider value={services}>{ui}</ServicesContext.Provider>,
  );
}

/** Build a SummaryResponse for the current month. */
function summaryForCurrentMonth(
  overrides: Partial<SummaryResponse> = {},
): SummaryResponse {
  const today = new Date();
  const month = monthKey(today.getFullYear(), today.getMonth() + 1);
  return {
    month,
    total: 12,
    by_priority: { critical: 2, medium: 5, low: 5 },
    ...overrides,
  };
}

describe("SummaryBar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the month total and per-priority breakdown", async () => {
    const getSummary = vi.fn().mockResolvedValue(summaryForCurrentMonth());
    const services = { apiClient: { getSummary }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <SummaryBar />);

    await waitFor(() =>
      expect(screen.getByText(/12 events this month/)).toBeInTheDocument(),
    );
    expect(screen.getByTitle("Critical: 2")).toBeInTheDocument();
    expect(screen.getByTitle("Medium: 5")).toBeInTheDocument();
    expect(screen.getByTitle("Low: 5")).toBeInTheDocument();
  });

  it("renders the next-7-days tally", async () => {
    const getSummary = vi.fn().mockResolvedValue(summaryForCurrentMonth());
    const services = { apiClient: { getSummary }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <SummaryBar />);

    await waitFor(() =>
      expect(screen.getByText(/in next 7 days/)).toBeInTheDocument(),
    );
  });

  it("renders an empty state without misleading counts", async () => {
    const getSummary = vi
      .fn()
      .mockResolvedValue(summaryForCurrentMonth({ total: 0, by_priority: {} }));
    const services = { apiClient: { getSummary }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <SummaryBar />);

    await waitFor(() =>
      expect(screen.getByText(/0 events this month/)).toBeInTheDocument(),
    );
    // No per-priority chips when there are no counts.
    expect(screen.queryByText(/Critical/)).not.toBeInTheDocument();
  });

  it("shows the error message when the load fails", async () => {
    const getSummary = vi.fn().mockRejectedValue(new Error("boom"));
    const services = { apiClient: { getSummary }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <SummaryBar />);

    await waitFor(() =>
      expect(screen.getByText("Failed to load summary")).toBeInTheDocument(),
    );
  });
});
