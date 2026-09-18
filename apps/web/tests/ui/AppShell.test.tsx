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

  it("renders the themeToggleSlot content in the header", () => {
    render(
      <AppShell
        view="timeline"
        onViewChange={() => {}}
        themeToggleSlot={<button>🌙</button>}
      >
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "🌙" })).toBeInTheDocument();
  });

  it("fills the viewport exactly: header stays put, content scrolls internally (#123)", () => {
    const { container } = render(
      <AppShell view="timeline" onViewChange={() => {}}>
        <p>content</p>
      </AppShell>,
    );

    // The shell root is exactly the viewport height (flex column) and can
    // never produce a page-level scrollbar.
    const shell = container.firstElementChild as HTMLElement;
    expect(shell).toHaveClass("h-dvh");
    expect(shell).toHaveClass("flex", "flex-col", "overflow-hidden");

    // The header keeps its natural height (never compressed) and stays
    // visible while the content scrolls.
    const header = shell.querySelector("header");
    expect(header).toHaveClass("shrink-0");

    // The content area is the single internal scroll container: it fills the
    // remaining height (`flex-1`), is allowed to shrink below its content
    // height (`min-h-0`, the flexbox overflow fix) and scrolls internally
    // instead of the document.
    const main = screen.getByRole("main");
    expect(main).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
  });
});
