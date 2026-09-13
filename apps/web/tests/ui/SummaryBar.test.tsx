import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryBar } from "../../src/ui/components/SummaryBar";
import type { SummaryState } from "../../src/ui/viewModels/useSummary";

// Mock the view model so the component's rendering branches can be exercised
// deterministically, regardless of the date the suite runs on.
const { useSummaryMock } = vi.hoisted(() => ({
  useSummaryMock: vi.fn(),
}));
vi.mock("../../src/ui/viewModels/useSummary", () => ({
  useSummary: useSummaryMock,
}));

function useSummaryAs(state: SummaryState) {
  useSummaryMock.mockReturnValue(state);
}

function renderSummaryBar() {
  return render(<SummaryBar />);
}

function loadedState(
  overrides: Partial<SummaryState> = {},
): SummaryState {
  return {
    summary: null,
    model: {
      monthly: { month: "2026-03", total: 12, byPriority: { critical: 2, medium: 5, low: 5 } },
      nextSevenDays: { total: 12, overdue: 0, hasOverdue: false },
    },
    loading: false,
    error: null,
    ...overrides,
  };
}

describe("SummaryBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the month total and per-priority breakdown", () => {
    useSummaryAs(loadedState());
    renderSummaryBar();

    expect(screen.getByText(/12 events this month/)).toBeInTheDocument();
    expect(screen.getByTitle("Critical: 2")).toBeInTheDocument();
    expect(screen.getByTitle("Medium: 5")).toBeInTheDocument();
    expect(screen.getByTitle("Low: 5")).toBeInTheDocument();
  });

  it("renders the next-7-days tally with an overdue highlight when hasOverdue is true", () => {
    useSummaryAs(
      loadedState({
        model: {
          monthly: { month: "2026-03", total: 12, byPriority: { critical: 2, medium: 5, low: 5 } },
          nextSevenDays: { total: 12, overdue: 3, hasOverdue: true },
        },
      }),
    );
    renderSummaryBar();

    expect(screen.getByText(/3 overdue in next 7 days/)).toBeInTheDocument();
  });

  it("renders the next-7-days tally without overdue when hasOverdue is false", () => {
    useSummaryAs(
      loadedState({
        model: {
          monthly: { month: "2026-03", total: 12, byPriority: { critical: 2, medium: 5, low: 5 } },
          nextSevenDays: { total: 12, overdue: 0, hasOverdue: false },
        },
      }),
    );
    renderSummaryBar();

    expect(screen.getByText(/12 in next 7 days/)).toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("renders a loading state while the summary is being fetched", () => {
    useSummaryAs(
      loadedState({ model: null, loading: true }),
    );
    renderSummaryBar();

    expect(screen.getByText(/Loading summary/)).toBeInTheDocument();
  });

  it("renders an empty state without misleading counts", () => {
    useSummaryAs(
      loadedState({
        model: {
          monthly: { month: "2026-03", total: 0, byPriority: { critical: 0, medium: 0, low: 0 } },
          nextSevenDays: { total: 0, overdue: 0, hasOverdue: false },
        },
      }),
    );
    renderSummaryBar();

    expect(screen.getByText(/0 events this month/)).toBeInTheDocument();
    // No per-priority chips when there are no counts.
    expect(screen.queryByText(/Critical/)).not.toBeInTheDocument();
  });

  it("shows the error message when the load fails", () => {
    useSummaryAs(
      loadedState({ model: null, error: "Failed to load summary" }),
    );
    renderSummaryBar();

    expect(screen.getByText("Failed to load summary")).toBeInTheDocument();
  });
});
