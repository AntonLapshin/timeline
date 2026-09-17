import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { TimelineView } from "../../src/ui/components/TimelineView";
import { ServicesContext, type Services } from "../../src/ui/services/context";
import type { EventRead } from "../../src/core/eventTypes";

function makeEvent(overrides: Partial<EventRead>): EventRead {
  return {
    id: 1,
    title: "Test",
    description: "",
    location_url: "",
    tags: [],
    type: "one_time",
    start_at: "2026-09-05T10:00:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: null,
    priority: "medium",
    channels: ["telegram"],
    reminder_offsets: [],
    remind_time_of_day: null,
    repeat_until_ack: false,
    snooze_allowed: false,
    email_enabled: false,
    email_to: null,
    source: "web",
    raw_input: null,
    ai_confidence: null,
    status: "active",
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
    ...overrides,
  };
}

function renderWithServices(services: Services, ui: ReactNode) {
  return render(
    <ServicesContext.Provider value={services}>{ui}</ServicesContext.Provider>,
  );
}

describe("TimelineView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders grouped events with priority, tag and recurrence badge", async () => {
    const listEvents = vi.fn().mockResolvedValue([
      makeEvent({
        id: 1,
        title: "HRA",
        start_at: "2026-09-05T10:00:00",
        priority: "critical",
        tags: ["health"],
        rrule: "FREQ=MONTHLY;INTERVAL=3",
      }),
    ]);
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <TimelineView />);

    await waitFor(() => expect(screen.getByText("HRA")).toBeInTheDocument());
    expect(screen.getByText("2026-09")).toBeInTheDocument();
    expect(screen.getByText("Week 1")).toBeInTheDocument();
    expect(screen.getByText(/every quarter/)).toBeInTheDocument();
    expect(screen.getByText("# health")).toBeInTheDocument();
    // Humanized relative date badge is rendered for the event start.
    expect(screen.getAllByTestId("relative-label").length).toBeGreaterThan(0);
  });

  it("shows the error message when the load fails", async () => {
    const listEvents = vi.fn().mockRejectedValue(new Error("boom"));
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <TimelineView />);

    await waitFor(() =>
      expect(screen.getByText("Failed to load events")).toBeInTheDocument(),
    );
  });

  it("retries the failed load when Retry is clicked", async () => {
    const listEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([makeEvent({ id: 1, title: "Recovered" })]);
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <TimelineView />);

    await waitFor(() =>
      expect(screen.getByText("Failed to load events")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Recovered")).toBeInTheDocument());
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it("refetches events when the refreshKey prop changes (post-save refresh)", async () => {
    const listEvents = vi.fn().mockResolvedValue([
      makeEvent({ id: 1, title: "HRA" }),
    ]);
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    const { rerender } = renderWithServices(services, <TimelineView />);

    await waitFor(() => expect(screen.getByText("HRA")).toBeInTheDocument());
    expect(listEvents).toHaveBeenCalledTimes(1);

    // Bumping the refresh key (e.g. after a wizard save, issue #121) re-runs
    // the fetch without a reload.
    rerender(
      <ServicesContext.Provider value={services}>
        <TimelineView refreshKey={1} />
      </ServicesContext.Provider>,
    );
    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(2));
    expect(screen.getByText("HRA")).toBeInTheDocument();
  });

  it("shows an empty state when there are no events", async () => {
    const listEvents = vi.fn().mockResolvedValue([]);
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <TimelineView />);

    await waitFor(() => expect(screen.getByText("No events yet.")).toBeInTheDocument());
  });

  it("calls onCreate from the empty state CTA", async () => {
    const listEvents = vi.fn().mockResolvedValue([]);
    const onCreate = vi.fn();
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <TimelineView onCreate={onCreate} />);

    await waitFor(() =>
      expect(screen.getByText("No events yet.")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /create your first event/i }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("shows a loading skeleton while fetching", async () => {
    let resolve!: (v: EventRead[]) => void;
    const listEvents = vi.fn().mockReturnValue(new Promise<EventRead[]>((r) => {
      resolve = r;
    }));
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <TimelineView />);

    expect(screen.getByTestId("timeline-loading")).toBeInTheDocument();
    resolve([]);
    await waitFor(() => expect(screen.getByText("No events yet.")).toBeInTheDocument());
  });

  it("shows a no-matches message when a filter excludes all events", async () => {
    const listEvents = vi.fn().mockResolvedValue([
      makeEvent({ id: 1, title: "HRA", priority: "critical" }),
    ]);
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    renderWithServices(
      services,
      <TimelineView filter={{ text: "", priority: "low", tag: null, month: null }} />,
    );

    await waitFor(() => expect(screen.getByText("No matches.")).toBeInTheDocument());
  });

  it("reveals more events on 'Load more'", async () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      makeEvent({ id: i + 1, title: `Event ${i + 1}` }),
    );
    const listEvents = vi.fn().mockResolvedValue(events);
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    renderWithServices(services, <TimelineView />);

    await waitFor(() => expect(screen.getByText("Event 1")).toBeInTheDocument());
    expect(screen.queryByText("Event 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Load more"));
    await waitFor(() => expect(screen.getByText("Event 11")).toBeInTheDocument());
    // Cumulative infinite-scroll: previously visible events must persist.
    expect(screen.getByText("Event 1")).toBeInTheDocument();
    expect(screen.getByText("Event 10")).toBeInTheDocument();
  });

  it("calls onEventClick with the event when a row is clicked", async () => {
    const event = makeEvent({ id: 1, title: "HRA" });
    const listEvents = vi.fn().mockResolvedValue([event]);
    const onEventClick = vi.fn();
    const services = { apiClient: { listEvents }, llmParser: {} } as unknown as Services;

    renderWithServices(
      services,
      <TimelineView onEventClick={onEventClick} />,
    );

    await waitFor(() => expect(screen.getByText("HRA")).toBeInTheDocument());
    fireEvent.click(screen.getByText("HRA"));
    expect(onEventClick).toHaveBeenCalledWith(event);
  });
});
