import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ShowcasePage } from "../../src/ui/showcase/ShowcasePage";

/**
 * Smoke-level tests for the dev-only Showcase gallery (issue #56).
 *
 * The Showcase page injects its own fake services via context, so rendering it
 * requires no backend or provider setup. These tests assert that every
 * component gallery section renders without crashing and that the populated
 * states (Timeline rows, summary bar, drawer, wizard) appear.
 */
describe("ShowcasePage", () => {
  it("renders a section for every UI component", () => {
    render(<ShowcasePage />);
    for (const title of [
      "AppShell",
      "TimelineView",
      "CalendarView",
      "SummaryBar",
      "EventDrawer",
      "EventWizard",
      "WizardStepOne / Two / Three",
      "SearchFilterBar",
      "SmartInputBox",
      "ThemeToggle",
      "DemoPanel",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("renders the populated Timeline rows from injected fake services", async () => {
    render(<ShowcasePage />);
    // The populated Timeline is shown in several gallery sections (AppShell,
    // TimelineView, CalendarView), so we assert at least one instance appears.
    await waitFor(() =>
      expect(screen.getAllByText("HRA quarterly check-up").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Product design review").length).toBeGreaterThan(0);
  });

  it("renders the summary bar with the populated monthly total", async () => {
    render(<ShowcasePage />);
    await waitFor(() =>
      expect(screen.getAllByText("3 events this month").length).toBeGreaterThan(0),
    );
  });

  it("renders the populated event drawer", () => {
    render(<ShowcasePage />);
    expect(screen.getByLabelText("Event: HRA quarterly check-up")).toBeInTheDocument();
  });

  it("renders the event wizard step previews", () => {
    render(<ShowcasePage />);
    // The wizard shows the step titles for all three steps.
    expect(screen.getAllByText("What/When").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recurrence").length).toBeGreaterThan(0);
  });
});
