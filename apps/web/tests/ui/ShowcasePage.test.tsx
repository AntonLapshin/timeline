import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { ShowcasePage } from "../../src/ui/showcase/ShowcasePage";

/**
 * Smoke-level tests for the dev-only Showcase gallery (issue #56) —
 * a Storybook-style playground with a sidebar, an isolated canvas per
 * component, and URL deep-linking (`?showcase&file=X&story=Y`).
 *
 * The gallery injects its own fake services via the registry, so rendering
 * requires no backend or provider setup.
 */

/** Renders the gallery at the given URL (defaults to the home grid). */
function renderAt(url: string) {
  window.history.pushState({}, "", url);
  return render(<ShowcasePage />);
}

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("ShowcasePage", () => {
  it("renders the home grid with a card for every UI component", () => {
    renderAt("?showcase");
    expect(
      screen.getByRole("heading", { name: "Component Showcase" }),
    ).toBeInTheDocument();
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

  it("opens a component canvas from its deep link", async () => {
    renderAt("?showcase&file=TimelineView");
    expect(
      screen.getByRole("heading", { name: "TimelineView" }),
    ).toBeInTheDocument();
    // The populated Timeline rows from injected fake services.
    await waitFor(() =>
      expect(screen.getAllByText("HRA quarterly check-up").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Product design review").length).toBeGreaterThan(0);
  });

  it("renders the summary bar with the populated monthly total", async () => {
    renderAt("?showcase&file=SummaryBar");
    await waitFor(() =>
      expect(screen.getAllByText("3 events this month").length).toBeGreaterThan(0),
    );
  });

  it("renders the populated event drawer in isolation", () => {
    renderAt("?showcase&file=EventDrawer");
    expect(screen.getByLabelText("Event: HRA quarterly check-up")).toBeInTheDocument();
  });

  it("renders the event wizard step previews", () => {
    renderAt("?showcase&file=EventWizard");
    // The wizard shows the step titles for all three steps.
    expect(screen.getAllByText("What/When").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recurrence").length).toBeGreaterThan(0);
  });

  it("navigates from the sidebar and updates the URL", async () => {
    renderAt("?showcase");
    const nav = screen.getByRole("navigation", { name: "Storybook files" });
    fireEvent.click(within(nav).getByRole("button", { name: "Button" }));
    await waitFor(() =>
      expect(window.location.search).toContain("file=Button"),
    );
    expect(
      screen.getByRole("heading", { name: "Button" }),
    ).toBeInTheDocument();
    // The Button stories render on the canvas.
    expect(screen.getByRole("heading", { name: "Variants × sizes" })).toBeInTheDocument();
  });

  it("filters the sidebar with the search box", () => {
    renderAt("?showcase");
    const nav = screen.getByRole("navigation", { name: "Storybook files" });
    const filter = screen.getByLabelText("Filter components");
    fireEvent.change(filter, { target: { value: "calendar" } });
    expect(
      within(nav).getByRole("button", { name: "CalendarView" }),
    ).toBeInTheDocument();
    expect(
      within(nav).queryByRole("button", { name: "Button" }),
    ).not.toBeInTheDocument();
  });
});
