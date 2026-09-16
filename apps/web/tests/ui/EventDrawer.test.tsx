import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventDrawer } from "../../src/ui/components/EventDrawer";
import type { EventDrawerState } from "../../src/ui/viewModels/useEventDrawer";
import type { EventRead } from "../../src/core/eventTypes";

// Mock the view model so the component's rendering branches can be exercised
// deterministically.
const { useEventDrawerMock } = vi.hoisted(() => ({
  useEventDrawerMock: vi.fn(),
}));
vi.mock("../../src/ui/viewModels/useEventDrawer", () => ({
  useEventDrawer: useEventDrawerMock,
}));

function sampleEvent(overrides: Partial<EventRead> = {}): EventRead {
  return {
    id: 3,
    title: "HRA",
    description: "Annual health check-up",
    location_url: "",
    tags: ["health"],
    type: "recurrent",
    start_at: "2026-09-05T10:00:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: "FREQ=MONTHLY;INTERVAL=3",
    priority: "critical",
    channels: ["telegram"],
    reminder_offsets: ["7d", "1d", "2h"],
    remind_time_of_day: "09:00",
    repeat_until_ack: false,
    snooze_allowed: true,
    email_enabled: false,
    email_to: null,
    source: "web",
    raw_input: null,
    ai_confidence: null,
    status: "active",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

function drawerState(overrides: Partial<EventDrawerState> = {}): EventDrawerState {
  return {
    event: sampleEvent(),
    open: true,
    loading: false,
    error: null,
    preview: {
      channels: ["telegram"],
      offsetsLabel: "7d / 1d / 2h",
      timeOfDay: "09:00",
      hasReminders: true,
    },
    occurrences: [],
    deliveriesLoading: false,
    deliveriesError: null,
    deliveries: [],
    openDrawer: vi.fn(),
    openFromOccurrence: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe("EventDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when no event is selected", () => {
    const close = vi.fn();
    useEventDrawerMock.mockReturnValue(
      drawerState({ event: null, open: false, preview: null, close }),
    );
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByTestId("event-drawer-empty")).toBeInTheDocument();
    expect(screen.getByText(/Select an event/)).toBeInTheDocument();
  });

  it("renders the event title, priority, tag, recurrence and notes", () => {
    useEventDrawerMock.mockReturnValue(drawerState());
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByRole("dialog", { name: /HRA/ })).toBeInTheDocument();
    expect(screen.getByText("HRA")).toBeInTheDocument();
    expect(screen.getByText("Annual health check-up")).toBeInTheDocument();
    expect(screen.getByText(/every quarter/)).toBeInTheDocument();
    expect(screen.getByText(/^# health$/)).toBeInTheDocument();
  });

  it("renders the reminder preview (channel, offsets, time of day)", () => {
    useEventDrawerMock.mockReturnValue(drawerState());
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.getByText("7d / 1d / 2h")).toBeInTheDocument();
    expect(screen.getByText("09:00")).toBeInTheDocument();
  });

  it("shows a no-reminders message when the event has none", () => {
    useEventDrawerMock.mockReturnValue(
      drawerState({
        preview: {
          channels: [],
          offsetsLabel: "",
          timeOfDay: null,
          hasReminders: false,
        },
      }),
    );
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByText(/No reminders configured/)).toBeInTheDocument();
  });

  it("renders the next occurrences list", () => {
    useEventDrawerMock.mockReturnValue(
      drawerState({
        occurrences: [
          {
            occurrence: {
              event_id: 3,
              title: "HRA",
              priority: "critical",
              tag: "health",
              rrule: "FREQ=MONTHLY;INTERVAL=3",
              start_at: "2026-09-05T10:00:00",
              all_day: false,
              tz: "UTC",
              next_occurrence: "2026-12-05T10:00:00",
            },
            row: {
              occurrence: {
                event_id: 3,
                title: "HRA",
                priority: "critical",
                tag: "health",
                rrule: "FREQ=MONTHLY;INTERVAL=3",
                start_at: "2026-09-05T10:00:00",
                all_day: false,
                tz: "UTC",
                next_occurrence: "2026-12-05T10:00:00",
              },
              priorityColor: "text-red-700 bg-red-50 border-red-200",
              priorityIcon: "!",
              tagColor: "",
              tagIcon: "#",
              recurrenceBadge: "every quarter",
              timeLabel: "Sat, Sep 5 · 10:00 AM",
              nextOccurrenceLabel: "Next: Sat, Dec 5",
              relativeLabel: "in 3 weeks",
            },
          },
        ],
      }),
    );
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByText("Sat, Sep 5 · 10:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Next: Sat, Dec 5")).toBeInTheDocument();
  });

  it("shows a loading state while occurrences load", () => {
    useEventDrawerMock.mockReturnValue(drawerState({ loading: true }));
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByText(/Loading occurrences/)).toBeInTheDocument();
  });

  it("shows an error when occurrences fail to load", () => {
    useEventDrawerMock.mockReturnValue(
      drawerState({ error: "Failed to load occurrences" }),
    );
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByText("Failed to load occurrences")).toBeInTheDocument();
  });

  it("renders the delivery log rows with status, time and detail", () => {
    useEventDrawerMock.mockReturnValue(
      drawerState({
        deliveries: [
          {
            log: {
              id: 2,
              event_id: 3,
              occurrence_id: "occ-2",
              offset: "1d",
              status: "acked",
              scheduled_at: "2026-09-05T09:00:00",
              sent_at: "2026-09-05T09:00:00",
              error: null,
              created_at: "2026-09-05T09:00:00",
              updated_at: "2026-09-05T09:00:00",
            },
            statusLabel: "Acknowledged",
            statusStyle: { color: "text-sky-700 bg-sky-50 border-sky-200", icon: "☑" },
            detailLabel: "1d before · occ-2",
            timeLabel: "Sep 5, 9:00 AM",
          },
        ],
      }),
    );
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByText("Delivery log")).toBeInTheDocument();
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByText("Sep 5, 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("1d before · occ-2")).toBeInTheDocument();
  });

  it("shows a no-deliveries message when the delivery log is empty", () => {
    useEventDrawerMock.mockReturnValue(drawerState());
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByText(/No deliveries yet/)).toBeInTheDocument();
  });

  it("shows a loading state while the delivery log loads", () => {
    useEventDrawerMock.mockReturnValue(drawerState({ deliveriesLoading: true }));
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByText(/Loading delivery log/)).toBeInTheDocument();
  });

  it("shows an error when the delivery log fails to load", () => {
    useEventDrawerMock.mockReturnValue(
      drawerState({ deliveriesError: "Failed to load delivery log" }),
    );
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.getByText("Failed to load delivery log")).toBeInTheDocument();
  });

  it("calls close when the close button is clicked", () => {
    const close = vi.fn();
    useEventDrawerMock.mockReturnValue(drawerState({ close }));
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    fireEvent.click(screen.getByLabelText("Close event drawer"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("calls onEdit when the edit button is clicked", () => {
    const onEdit = vi.fn();
    useEventDrawerMock.mockReturnValue(drawerState());
    render(<EventDrawer drawer={useEventDrawerMock()} onEdit={onEdit} />);
    fireEvent.click(screen.getByText("Edit event"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("does not render an edit button when no onEdit is provided", () => {
    useEventDrawerMock.mockReturnValue(drawerState());
    render(<EventDrawer drawer={useEventDrawerMock()} />);
    expect(screen.queryByText("Edit event")).not.toBeInTheDocument();
  });
});
