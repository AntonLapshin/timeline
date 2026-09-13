import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppShell } from "../../src/ui/components/AppShell";

describe("AppShell", () => {
  it("renders the active view content and header title", () => {
    render(
      <AppShell view="timeline" onViewChange={() => {}}>
        <p>Timeline content</p>
      </AppShell>,
    );
    expect(screen.getByRole("heading", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByText("Timeline content")).toBeInTheDocument();
  });

  it("calls onViewChange('calendar') when the Calendar tab is clicked", () => {
    const onViewChange = vi.fn();
    render(
      <AppShell view="timeline" onViewChange={onViewChange}>
        <p>content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(onViewChange).toHaveBeenCalledWith("calendar");
  });

  it("calls onViewChange('timeline') when the Timeline tab is clicked", () => {
    const onViewChange = vi.fn();
    render(
      <AppShell view="calendar" onViewChange={onViewChange}>
        <p>content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(onViewChange).toHaveBeenCalledWith("timeline");
  });

  it("sets aria-pressed on the active tab", () => {
    render(
      <AppShell view="calendar" onViewChange={() => {}}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Calendar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Timeline" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders the summarySlot content in the header", () => {
    render(
      <AppShell
        view="timeline"
        onViewChange={() => {}}
        summarySlot={<span>Summary bar</span>}
      >
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByText("Summary bar")).toBeInTheDocument();
  });

  it("renders the actions slot in the header", () => {
    render(
      <AppShell
        view="timeline"
        onViewChange={() => {}}
        actions={<button>+ New</button>}
      >
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "+ New" })).toBeInTheDocument();
  });

  it("renders the smartInputSlot content in the header", () => {
    render(
      <AppShell
        view="timeline"
        onViewChange={() => {}}
        smartInputSlot={<span>Smart input</span>}
      >
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByText("Smart input")).toBeInTheDocument();
  });
});
