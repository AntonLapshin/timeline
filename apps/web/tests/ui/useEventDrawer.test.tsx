import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEventDrawer } from "../../src/ui/viewModels/useEventDrawer";
import type { EventOccurrence, EventRead } from "../../src/core/eventTypes";

// Mock the injected services so the view model's I/O is deterministic.
const { useServicesMock } = vi.hoisted(() => ({
  useServicesMock: vi.fn(),
}));
vi.mock("../../src/ui/services/useServices", () => ({
  useServices: useServicesMock,
}));

function sampleEvent(overrides: Partial<EventRead> = {}): EventRead {
  return {
    id: 3,
    title: "HRA",
    description: "Annual review",
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
    reminder_offsets: ["7d", "1d"],
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

function makeOccurrence(overrides: Partial<EventOccurrence>): EventOccurrence {
  return {
    event_id: 3,
    title: "HRA",
    priority: "critical",
    tag: "health",
    rrule: "FREQ=MONTHLY;INTERVAL=3",
    start_at: "2026-09-05T10:00:00",
    all_day: false,
    tz: "UTC",
    next_occurrence: "2026-12-05T10:00:00",
    ...overrides,
  };
}

describe("useEventDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServicesMock.mockReturnValue({
      apiClient: {
        getOccurrences: vi.fn().mockResolvedValue([]),
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        getSummary: vi.fn(),
        getEventDeliveries: vi.fn().mockResolvedValue([]),
      },
      llmParser: {},
    });
  });

  it("starts closed with no event selected", () => {
    const { result } = renderHook(() => useEventDrawer());
    expect(result.current.open).toBe(false);
    expect(result.current.event).toBeNull();
    expect(result.current.preview).toBeNull();
    expect(result.current.occurrences).toEqual([]);
  });

  it("openDrawer selects the event and derives a reminder preview", async () => {
    const { result } = renderHook(() => useEventDrawer());
    act(() => result.current.openDrawer(sampleEvent()));
    expect(result.current.open).toBe(true);
    expect(result.current.event?.id).toBe(3);
    expect(result.current.preview?.channels).toEqual(["telegram"]);
    expect(result.current.preview?.offsetsLabel).toBe("7d / 1d");
    expect(result.current.preview?.timeOfDay).toBe("09:00");
  });

  it("fetches and derives the event's next occurrences", async () => {
    const getOccurrences = vi.fn().mockResolvedValue([
      makeOccurrence({ start_at: "2026-09-10T10:00:00" }),
      makeOccurrence({ start_at: "2026-09-05T10:00:00" }),
      makeOccurrence({ event_id: 99, start_at: "2026-09-20T10:00:00" }),
    ]);
    useServicesMock.mockReturnValue({
      apiClient: {
        getOccurrences,
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        getSummary: vi.fn(),
        getEventDeliveries: vi.fn().mockResolvedValue([]),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventDrawer());
    act(() => result.current.openDrawer(sampleEvent()));
    expect(getOccurrences).toHaveBeenCalledWith("2026-09");
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.occurrences.map((o) => o.occurrence.start_at)).toEqual([
      "2026-09-05T10:00:00",
      "2026-09-10T10:00:00",
    ]);
  });

  it("reports an error when occurrences fail to load", async () => {
    useServicesMock.mockReturnValue({
      apiClient: {
        getOccurrences: vi.fn().mockRejectedValue(new Error("boom")),
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        getSummary: vi.fn(),
        getEventDeliveries: vi.fn().mockResolvedValue([]),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventDrawer());
    act(() => result.current.openDrawer(sampleEvent()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to load occurrences");
  });

  it("fetches and derives the event's delivery log", async () => {
    const getEventDeliveries = vi.fn().mockResolvedValue([
      {
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
      {
        id: 1,
        event_id: 3,
        occurrence_id: "occ-1",
        offset: "1d",
        status: "sent",
        scheduled_at: "2026-09-01T09:00:00",
        sent_at: "2026-09-01T09:00:00",
        error: null,
        created_at: "2026-09-01T09:00:00",
        updated_at: "2026-09-01T09:00:00",
      },
    ]);
    useServicesMock.mockReturnValue({
      apiClient: {
        getOccurrences: vi.fn().mockResolvedValue([]),
        getEventDeliveries,
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        getSummary: vi.fn(),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventDrawer());
    act(() => result.current.openDrawer(sampleEvent()));
    expect(getEventDeliveries).toHaveBeenCalledWith(3);
    await waitFor(() => expect(result.current.deliveriesLoading).toBe(false));
    // Newest first, derived into display rows.
    expect(result.current.deliveries.map((d) => d.log.id)).toEqual([2, 1]);
    expect(result.current.deliveries[0].statusLabel).toBe("Acknowledged");
    expect(result.current.deliveries[1].statusLabel).toBe("Sent");
  });

  it("reports an error when the delivery log fails to load", async () => {
    useServicesMock.mockReturnValue({
      apiClient: {
        getOccurrences: vi.fn().mockResolvedValue([]),
        getEventDeliveries: vi.fn().mockRejectedValue(new Error("boom")),
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        getSummary: vi.fn(),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventDrawer());
    act(() => result.current.openDrawer(sampleEvent()));
    await waitFor(() => expect(result.current.deliveriesLoading).toBe(false));
    expect(result.current.deliveriesError).toBe("Failed to load delivery log");
  });

  it("close clears the selected event and occurrences", async () => {
    const { result } = renderHook(() => useEventDrawer());
    act(() => result.current.openDrawer(sampleEvent()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(result.current.event).toBeNull();
    expect(result.current.occurrences).toEqual([]);
  });

  it("closes on the Escape key", async () => {
    const { result } = renderHook(() => useEventDrawer());
    act(() => result.current.openDrawer(sampleEvent()));
    expect(result.current.open).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.open).toBe(false);
  });

  it("openFromOccurrence fetches the full event and opens the drawer", async () => {
    const getEvent = vi.fn().mockResolvedValue(sampleEvent());
    useServicesMock.mockReturnValue({
      apiClient: {
        getOccurrences: vi.fn().mockResolvedValue([]),
        getEvent,
        listEvents: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        getSummary: vi.fn(),
        getEventDeliveries: vi.fn().mockResolvedValue([]),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventDrawer());
    await act(async () => {
      await result.current.openFromOccurrence(
        makeOccurrence({ event_id: 3 }),
      );
    });
    expect(getEvent).toHaveBeenCalledWith(3);
    expect(result.current.open).toBe(true);
    expect(result.current.event?.id).toBe(3);
    expect(result.current.preview?.offsetsLabel).toBe("7d / 1d");
  });

  it("openFromOccurrence reports an error when the event fails to load", async () => {
    useServicesMock.mockReturnValue({
      apiClient: {
        getOccurrences: vi.fn().mockResolvedValue([]),
        getEvent: vi.fn().mockRejectedValue(new Error("boom")),
        listEvents: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        getSummary: vi.fn(),
        getEventDeliveries: vi.fn().mockResolvedValue([]),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventDrawer());
    await act(async () => {
      await result.current.openFromOccurrence(
        makeOccurrence({ event_id: 3 }),
      );
    });
    expect(result.current.error).toBe("Failed to load event");
    expect(result.current.open).toBe(false);
  });
});
