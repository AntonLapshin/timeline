import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../../src/App";
import type { EventWizardState } from "../../src/ui/viewModels/useEventWizard";
import type { EventDrawerState } from "../../src/ui/viewModels/useEventDrawer";

// Isolate the App-level keyboard-shortcut behavior: mock the wizard view model
// (so we can assert openCreate is invoked) and stub the child components so the
// test doesn't depend on real I/O or the services provider.
const { useEventWizardMock, useEventDrawerMock, useServicesMock } = vi.hoisted(
  () => ({
    useEventWizardMock: vi.fn(),
    useEventDrawerMock: vi.fn(),
    useServicesMock: vi.fn(),
  }),
);
vi.mock("../../src/ui/viewModels/useEventWizard", () => ({
  useEventWizard: useEventWizardMock,
}));
vi.mock("../../src/ui/viewModels/useEventDrawer", () => ({
  useEventDrawer: useEventDrawerMock,
}));
vi.mock("../../src/ui/services/useServices", () => ({
  useServices: useServicesMock,
}));
vi.mock("../../src/ui/components/SummaryBar", () => ({
  SummaryBar: () => <div data-testid="summary-bar" />,
}));
vi.mock("../../src/ui/components/TimelineView", () => ({
  TimelineView: () => <div data-testid="timeline-view" />,
}));
vi.mock("../../src/ui/components/CalendarView", () => ({
  CalendarView: () => <div data-testid="calendar-view" />,
}));
vi.mock("../../src/ui/components/EventWizard", () => ({
  EventWizard: () => <div data-testid="event-wizard" />,
}));
vi.mock("../../src/ui/components/EventDrawer", () => ({
  EventDrawer: () => <div data-testid="event-drawer" />,
}));
vi.mock("../../src/ui/services/ServicesProvider", () => ({
  ServicesProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

function wizardState(overrides: Partial<EventWizardState> = {}): EventWizardState {
  return {
    open: false,
    editingEvent: null,
    step: 1,
    draft: {
      title: "",
      notes: "",
      allDay: false,
      date: "",
      time: "",
      tz: "UTC",
      recurrence: "none",
      customRrule: "",
      priority: "medium",
      channels: ["telegram"],
      reminderOffsets: [],
    },
    errors: {},
    canNext: false,
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

function drawerState(overrides: Partial<EventDrawerState> = {}): EventDrawerState {
  return {
    event: null,
    open: false,
    loading: false,
    error: null,
    preview: null,
    occurrences: [],
    openDrawer: vi.fn(),
    openFromOccurrence: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEventDrawerMock.mockReturnValue(drawerState());
    useServicesMock.mockReturnValue({
      apiClient: { listEvents: vi.fn().mockResolvedValue([]) },
      llmParser: {},
    });
  });

  it("opens the create wizard when the `c` key is pressed", () => {
    const openCreate = vi.fn();
    useEventWizardMock.mockReturnValue(wizardState({ openCreate, open: false }));
    render(<App />);
    expect(screen.queryByTestId("event-wizard")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "c" });
    expect(openCreate).toHaveBeenCalledTimes(1);
  });

  it("does not open the create wizard on other keys", () => {
    const openCreate = vi.fn();
    useEventWizardMock.mockReturnValue(wizardState({ openCreate, open: false }));
    render(<App />);

    fireEvent.keyDown(window, { key: "x" });
    expect(openCreate).not.toHaveBeenCalled();
  });

  it("does not re-open the wizard when it is already open", () => {
    const openCreate = vi.fn();
    useEventWizardMock.mockReturnValue(wizardState({ openCreate, open: true }));
    render(<App />);

    fireEvent.keyDown(window, { key: "c" });
    expect(openCreate).not.toHaveBeenCalled();
  });

  it("renders the wizard when the state is open", () => {
    useEventWizardMock.mockReturnValue(wizardState({ open: true }));
    render(<App />);
    expect(screen.getByTestId("event-wizard")).toBeInTheDocument();
  });

  it("opens the create wizard via the + New header action", () => {
    const openCreate = vi.fn();
    useEventWizardMock.mockReturnValue(wizardState({ openCreate, open: false }));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    expect(openCreate).toHaveBeenCalledTimes(1);
  });

  it("removes the keydown listener on unmount", () => {
    const openCreate = vi.fn();
    useEventWizardMock.mockReturnValue(wizardState({ openCreate, open: false }));
    const { unmount } = render(<App />);
    unmount();

    fireEvent.keyDown(window, { key: "c" });
    expect(openCreate).not.toHaveBeenCalled();
  });

  it("renders the event drawer when an event is selected", () => {
    useEventDrawerMock.mockReturnValue(
      drawerState({ event: { id: 3 } as never, open: true }),
    );
    render(<App />);
    expect(screen.getByTestId("event-drawer")).toBeInTheDocument();
  });

  it("does not render the event drawer when no event is selected", () => {
    useEventDrawerMock.mockReturnValue(drawerState());
    render(<App />);
    expect(screen.queryByTestId("event-drawer")).not.toBeInTheDocument();
  });

  it("focuses the search box when the `/` key is pressed", () => {
    useEventWizardMock.mockReturnValue(wizardState({ open: false }));
    render(<App />);
    const input = screen.getByLabelText("Search events");
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(input);
  });

  it("does not focus the search box on the `/` key when the wizard is open", () => {
    useEventWizardMock.mockReturnValue(wizardState({ open: true }));
    render(<App />);
    const input = screen.getByLabelText("Search events");

    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).not.toBe(input);
  });
});
