import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEventWizard } from "../../src/ui/viewModels/useEventWizard";
import type { EventRead } from "../../src/core/eventTypes";

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
    remind_time_of_day: null,
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

describe("useEventWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServicesMock.mockReturnValue({
      apiClient: {
        createEvent: vi.fn().mockResolvedValue(sampleEvent()),
        updateEvent: vi.fn().mockResolvedValue(sampleEvent()),
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        getSummary: vi.fn(),
        getOccurrences: vi.fn(),
        getEventDeliveries: vi.fn(),
      },
      llmParser: {},
    });
  });

  it("starts closed with step 1", () => {
    const { result } = renderHook(() => useEventWizard());
    expect(result.current.open).toBe(false);
    expect(result.current.step).toBe(1);
    expect(result.current.editingEvent).toBeNull();
  });

  it("openCreate opens the wizard with an empty draft", () => {
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openCreate());
    expect(result.current.open).toBe(true);
    expect(result.current.editingEvent).toBeNull();
    expect(result.current.draft.title).toBe("");
  });

  it("openEdit opens the wizard pre-filled from the event", () => {
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openEdit(sampleEvent()));
    expect(result.current.open).toBe(true);
    expect(result.current.editingEvent?.id).toBe(3);
    expect(result.current.draft.title).toBe("HRA");
    expect(result.current.draft.recurrence).toBe("quarterly");
  });

  it("openCreateWithDraft opens the wizard pre-filled from a parsed draft", () => {
    const { result } = renderHook(() => useEventWizard());
    act(() =>
      result.current.openCreateWithDraft({
        title: "Dentist",
        notes: "",
        allDay: false,
        date: "2026-09-22",
        time: "15:00",
        tz: "UTC",
        recurrence: "none",
        customRrule: "",
        priority: "medium",
        channels: ["telegram"],
        reminderOffsets: [],
      }),
    );
    expect(result.current.open).toBe(true);
    expect(result.current.editingEvent).toBeNull();
    expect(result.current.draft.title).toBe("Dentist");
    expect(result.current.draft.date).toBe("2026-09-22");
    expect(result.current.draft.priority).toBe("medium");
  });

  it("close closes the wizard and clears saved/error", () => {
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openCreate());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  it("next/back move between steps and clamp at the ends", () => {
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openCreate());
    expect(result.current.step).toBe(1);
    act(() => result.current.next());
    expect(result.current.step).toBe(2);
    act(() => result.current.next());
    expect(result.current.step).toBe(3);
    act(() => result.current.next());
    expect(result.current.step).toBe(3);
    act(() => result.current.back());
    expect(result.current.step).toBe(2);
    act(() => result.current.back());
    act(() => result.current.back());
    expect(result.current.step).toBe(1);
  });

  it("update patches the draft", () => {
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openCreate());
    act(() => result.current.update({ title: "Standup" }));
    expect(result.current.draft.title).toBe("Standup");
  });

  it("canNext reflects whether the current step is complete", () => {
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openCreate());
    // Empty title → cannot advance past step 1.
    expect(result.current.canNext).toBe(false);
    act(() => result.current.update({ title: "Standup" }));
    expect(result.current.canNext).toBe(true);
  });

  it("save creates an event via the API and sets saved", async () => {
    const createEvent = vi.fn().mockResolvedValue(sampleEvent());
    useServicesMock.mockReturnValue({
      apiClient: {
        createEvent,
        updateEvent: vi.fn(),
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        getSummary: vi.fn(),
        getOccurrences: vi.fn(),
        getEventDeliveries: vi.fn(),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openCreate());
    act(() => result.current.update({ title: "Standup" }));
    await act(async () => {
      await result.current.save();
    });
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(result.current.saved).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("save updates an existing event via the API", async () => {
    const updateEvent = vi.fn().mockResolvedValue(sampleEvent());
    useServicesMock.mockReturnValue({
      apiClient: {
        createEvent: vi.fn(),
        updateEvent,
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        getSummary: vi.fn(),
        getOccurrences: vi.fn(),
        getEventDeliveries: vi.fn(),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openEdit(sampleEvent()));
    await act(async () => {
      await result.current.save();
    });
    expect(updateEvent).toHaveBeenCalledWith(3, expect.any(Object));
    expect(result.current.saved).toBe(true);
  });

  it("save refuses an incomplete draft and sets an error", async () => {
    const createEvent = vi.fn();
    useServicesMock.mockReturnValue({
      apiClient: {
        createEvent,
        updateEvent: vi.fn(),
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        getSummary: vi.fn(),
        getOccurrences: vi.fn(),
        getEventDeliveries: vi.fn(),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openCreate());
    await act(async () => {
      await result.current.save();
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Please complete all required fields");
    expect(result.current.saved).toBe(false);
  });

  it("save reports an error when the API call fails", async () => {
    useServicesMock.mockReturnValue({
      apiClient: {
        createEvent: vi.fn().mockRejectedValue(new Error("boom")),
        updateEvent: vi.fn(),
        listEvents: vi.fn(),
        getEvent: vi.fn(),
        getSummary: vi.fn(),
        getOccurrences: vi.fn(),
        getEventDeliveries: vi.fn(),
      },
      llmParser: {},
    });
    const { result } = renderHook(() => useEventWizard());
    act(() => result.current.openCreate());
    act(() => result.current.update({ title: "Standup" }));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.error).toBe("Failed to save event");
    expect(result.current.saved).toBe(false);
  });
});
