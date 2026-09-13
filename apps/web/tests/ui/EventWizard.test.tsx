import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventWizard } from "../../src/ui/components/EventWizard";
import type { EventWizardState } from "../../src/ui/viewModels/useEventWizard";
import type { EventDraft } from "../../src/core/eventWizard";

// Mock the view model so the container's render branches can be exercised
// deterministically.
const { useEventWizardMock } = vi.hoisted(() => ({
  useEventWizardMock: vi.fn(),
}));
vi.mock("../../src/ui/viewModels/useEventWizard", () => ({
  useEventWizard: useEventWizardMock,
}));

function draft(): EventDraft {
  return {
    title: "Dentist",
    notes: "",
    allDay: false,
    date: "2026-09-20",
    time: "10:00",
    tz: "UTC",
    recurrence: "none",
    customRrule: "",
    priority: "medium",
    channels: ["telegram"],
    reminderOffsets: [],
  };
}

function wizardState(overrides: Partial<EventWizardState> = {}): EventWizardState {
  return {
    open: true,
    editingEvent: null,
    step: 1,
    draft: draft(),
    errors: {},
    canNext: true,
    saving: false,
    error: null,
    saved: false,
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    close: vi.fn(),
    next: vi.fn(),
    back: vi.fn(),
    update: vi.fn(),
    save: vi.fn(),
    ...overrides,
  };
}

function renderWizard(state: EventWizardState) {
  useEventWizardMock.mockReturnValue(state);
  return render(<EventWizard wizard={state} />);
}

describe("EventWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the create heading and step 1 fields", () => {
    renderWizard(wizardState());
    expect(screen.getByText("New event")).toBeInTheDocument();
    expect(screen.getByText("What/When")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What's the event?")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-09-20")).toBeInTheDocument();
  });

  it("renders the edit heading when editing an existing event", () => {
    renderWizard(wizardState({ editingEvent: { id: 3 } as never }));
    expect(screen.getByText("Edit event")).toBeInTheDocument();
  });

  it("advances to step 2 and shows recurrence choices on Next", () => {
    const next = vi.fn();
    renderWizard(wizardState({ step: 2, next }));
    expect(screen.getAllByText("Recurrence").length).toBeGreaterThan(0);
    expect(screen.getByText("Monthly")).toBeInTheDocument();
  });

  it("renders the custom rule input only when recurrence is custom", () => {
    const state = wizardState({
      step: 2,
      draft: { ...draft(), recurrence: "custom" },
    });
    renderWizard(state);
    expect(
      screen.getByPlaceholderText("e.g. FREQ=WEEKLY;BYDAY=MO,WE"),
    ).toBeInTheDocument();
  });

  it("renders priority and reminder controls on step 3", () => {
    renderWizard(wizardState({ step: 3 }));
    expect(screen.getByText("Priority & Reminders")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("Reminder channels")).toBeInTheDocument();
  });

  it("calls next when Next is clicked and canNext is true", () => {
    const next = vi.fn();
    renderWizard(wizardState({ next }));
    fireEvent.click(screen.getByText("Next"));
    expect(next).toHaveBeenCalled();
  });

  it("disables Next when the step cannot advance", () => {
    const next = vi.fn();
    renderWizard(wizardState({ canNext: false, next }));
    const button = screen.getByText("Next") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("calls back when Back is clicked", () => {
    const back = vi.fn();
    renderWizard(wizardState({ step: 2, back }));
    fireEvent.click(screen.getByText("Back"));
    expect(back).toHaveBeenCalled();
  });

  it("disables Back on step 1", () => {
    renderWizard(wizardState());
    const button = screen.getByText("Back") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("calls save on step 3 and shows a saving state", () => {
    const save = vi.fn();
    renderWizard(wizardState({ step: 3, saving: true, save }));
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Saving…"));
    expect(save).not.toHaveBeenCalled();
  });

  it("calls save on step 3 when not saving", () => {
    const save = vi.fn();
    renderWizard(wizardState({ step: 3, save }));
    fireEvent.click(screen.getByText("Save event"));
    expect(save).toHaveBeenCalled();
  });

  it("shows the error message when present", () => {
    renderWizard(wizardState({ error: "Failed to save event" }));
    expect(screen.getByText("Failed to save event")).toBeInTheDocument();
  });

  it("shows the saved success message when present", () => {
    renderWizard(wizardState({ step: 3, saved: true }));
    expect(screen.getByText("Event created.")).toBeInTheDocument();
  });

  it("calls close when the close button is clicked", () => {
    const close = vi.fn();
    renderWizard(wizardState({ close }));
    fireEvent.click(screen.getByLabelText("Close wizard"));
    expect(close).toHaveBeenCalled();
  });
});
