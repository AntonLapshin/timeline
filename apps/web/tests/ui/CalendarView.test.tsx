import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { CalendarView } from "../../src/ui/components/CalendarView";
import { ServicesContext, type Services } from "../../src/ui/services/context";
import { weekGrid, weekStart } from "../../src/core/calendar";
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

function renderWithServices(services: Services, ui: ReactNode) {
  return render(
    <ServicesContext.Provider value={services}>{ui}</ServicesContext.Provider>,
  );
}

function apiClientWith(getOccurrences: Services["apiClient"]["getOccurrences"]) {
  return { getOccurrences } as unknown as Services["apiClient"];
}

describe("CalendarView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the month grid with the current month label and day counts", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({
        event_id: 1,
        title: "HRA",
        start_at: "2026-09-05T10:00:00",
        priority: "critical",
        tag: "health",
        rrule: "FREQ=MONTHLY;INTERVAL=3",
      }),
      makeOccurrence({ event_id: 2, title: "Lunch", start_at: "2026-09-05T12:00:00" }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
    // The month label is the current month.
    expect(screen.getByText("Sun")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
    // A day with two occurrences shows the count dots.
    expect(screen.getByLabelText("2026-09-05, 2 events")).toBeInTheDocument();
  });

  it("opens the day drawer on click and lists the day's occurrences", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({
        event_id: 1,
        title: "HRA",
        start_at: "2026-09-05T10:00:00",
        priority: "critical",
        tag: "health",
        rrule: "FREQ=MONTHLY;INTERVAL=3",
        next_occurrence: "2026-12-05T10:00:00",
      }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByLabelText("2026-09-05, 1 event")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("2026-09-05, 1 event"));

    expect(screen.getByText("HRA")).toBeInTheDocument();
    expect(screen.getByText(/every quarter/)).toBeInTheDocument();
    expect(screen.getByText(/Next: Sat, Dec 5/)).toBeInTheDocument();
    expect(screen.getByText("# health")).toBeInTheDocument();
  });

  it("shows an empty message for a day with no events", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText(/2026-09-01, 0 events/));
    expect(screen.getByText("No events this day.")).toBeInTheDocument();
  });

  it("closes the day drawer", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "HRA", start_at: "2026-09-05T10:00:00" }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByLabelText("2026-09-05, 1 event")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("2026-09-05, 1 event"));
    expect(screen.getByText("HRA")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByText("HRA")).not.toBeInTheDocument();
  });

  it("navigates months with prev/next buttons", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("Next"));
    await waitFor(() =>
      expect(screen.getByText(/October 2026/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("Previous"));
    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
  });

  it("shows the error message when the load fails", async () => {
    const getOccurrences = vi.fn().mockRejectedValue(new Error("boom"));
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByText("Failed to load occurrences")).toBeInTheDocument(),
    );
  });

  it("retries the failed load when Retry is clicked", async () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const getOccurrences = vi.fn().mockRejectedValue(new Error("boom"));
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByText("Failed to load occurrences")).toBeInTheDocument(),
    );
    // The view fetches the previous, current and next months together.
    expect(getOccurrences).toHaveBeenCalledTimes(3);
    getOccurrences.mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "Recovered", start_at: `${todayIso}T10:00:00` }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByLabelText(`${todayIso}, 1 event`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText(`${todayIso}, 1 event`));
    await waitFor(() => expect(screen.getByText("Recovered")).toBeInTheDocument());
    expect(getOccurrences).toHaveBeenCalledTimes(6);
  });

  it("refetches occurrences when the refreshKey prop changes (post-save refresh)", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "HRA", start_at: "2026-09-05T10:00:00" }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    const { rerender } = renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByLabelText("2026-09-05, 1 event")).toBeInTheDocument(),
    );
    // Previous, current and next months are fetched together.
    expect(getOccurrences).toHaveBeenCalledTimes(3);

    // Bumping the refresh key (e.g. after a wizard save, issue #121) re-runs
    // the fetch without a reload.
    rerender(
      <ServicesContext.Provider value={services}>
        <CalendarView refreshKey={1} />
      </ServicesContext.Provider>,
    );
    await waitFor(() => expect(getOccurrences).toHaveBeenCalledTimes(6));
    expect(screen.getByLabelText("2026-09-05, 1 event")).toBeInTheDocument();
  });

  it("shows a loading skeleton while fetching", async () => {
    let resolve!: (v: EventOccurrence[]) => void;
    const getOccurrences = vi
      .fn()
      .mockReturnValue(new Promise<EventOccurrence[]>((r) => {
        resolve = r;
      }));
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    expect(screen.getByTestId("calendar-loading")).toBeInTheDocument();
    resolve([]);
    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
  });

  it("switches to the week grid and places events by day", async () => {
    // Place occurrences on today's date so they always fall in the current
    // week and the fetched (current) month, regardless of when the suite runs.
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "HRA", start_at: `${todayIso}T10:00:00` }),
      makeOccurrence({ event_id: 2, title: "AllDay", start_at: `${todayIso}T00:00:00`, all_day: true }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Week"));
    // The week label reflects the week containing today (the view model's
    // week cursor starts at the current week).
    const expectedLabel = weekGrid(weekStart(new Date())).label;
    await waitFor(() =>
      expect(screen.getByText(expectedLabel)).toBeInTheDocument(),
    );
    expect(screen.getByText("HRA")).toBeInTheDocument();
    expect(screen.getByText("AllDay")).toBeInTheDocument();
  });

  it("switches to the agenda list with chronological rows", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "Later", start_at: "2026-09-29T10:00:00" }),
      makeOccurrence({ event_id: 2, title: "Sooner", start_at: "2026-09-28T09:00:00" }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Agenda"));
    await waitFor(() => expect(screen.getByText("Sooner")).toBeInTheDocument());
    expect(screen.getByText("Later")).toBeInTheDocument();
    expect(screen.getByText("9:00 AM")).toBeInTheDocument();
  });

  it("shows an empty state for the agenda with no upcoming events", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "Past", start_at: "2026-09-01T10:00:00" }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(services, <CalendarView />);

    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Agenda"));
    await waitFor(() =>
      expect(screen.getByText(/No upcoming events/)).toBeInTheDocument(),
    );
  });

  it("shows a no-matches message in the agenda when a filter excludes all events", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "HRA", priority: "critical" }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;

    renderWithServices(
      services,
      <CalendarView
        filter={{ text: "", priority: "low", tag: null, month: null }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Agenda"));
    await waitFor(() => expect(screen.getByText("No matches.")).toBeInTheDocument());
  });

  it("calls onEventClick with the occurrence when a day-drawer row is clicked", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "HRA", start_at: "2026-09-05T10:00:00" }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;
    const onEventClick = vi.fn();

    renderWithServices(services, <CalendarView onEventClick={onEventClick} />);

    await waitFor(() =>
      expect(screen.getByLabelText("2026-09-05, 1 event")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("2026-09-05, 1 event"));
    fireEvent.click(screen.getByText("HRA"));

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: 1, title: "HRA" }),
    );
  });

  it("calls onEventClick with the occurrence when a week-grid chip is clicked", async () => {
    // Place the occurrence on today's date so it always falls in the current
    // week (and the fetched current month), regardless of when the suite runs.
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "HRA", start_at: `${todayIso}T10:00:00` }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;
    const onEventClick = vi.fn();

    renderWithServices(services, <CalendarView onEventClick={onEventClick} />);

    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Week"));
    await waitFor(() => expect(screen.getByText("HRA")).toBeInTheDocument());
    fireEvent.click(screen.getByText("HRA"));

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: 1, title: "HRA" }),
    );
  });

  it("calls onEventClick with the occurrence when an agenda row is clicked", async () => {
    // Use a future date so the occurrence appears in the upcoming agenda.
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const futureIso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ event_id: 1, title: "HRA", start_at: `${futureIso}T10:00:00` }),
    ]);
    const services = {
      apiClient: apiClientWith(getOccurrences),
      llmParser: {},
    } as unknown as Services;
    const onEventClick = vi.fn();

    renderWithServices(services, <CalendarView onEventClick={onEventClick} />);

    await waitFor(() =>
      expect(screen.getByText(/September 2026/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Agenda"));
    await waitFor(() => expect(screen.getByText("HRA")).toBeInTheDocument());
    fireEvent.click(screen.getByText("HRA"));

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: 1, title: "HRA" }),
    );
  });
});
