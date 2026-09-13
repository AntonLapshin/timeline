import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchFilterBar } from "../../src/ui/components/SearchFilterBar";
import { EMPTY_FILTER } from "../../src/core/searchFilter";

function renderBar(
  overrides: Partial<Parameters<typeof SearchFilterBar>[0]> = {},
) {
  const props = {
    filter: EMPTY_FILTER,
    tags: [],
    months: [],
    onTextChange: vi.fn(),
    onPriorityChange: vi.fn(),
    onTagChange: vi.fn(),
    onMonthChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  const view = render(<SearchFilterBar {...props} />);
  return { props, view };
}

describe("SearchFilterBar", () => {
  it("renders the search input with the current text", () => {
    renderBar({ filter: { ...EMPTY_FILTER, text: "hra" } });
    expect(screen.getByLabelText("Search events")).toHaveValue("hra");
  });

  it("forwards text changes", () => {
    const { props } = renderBar();
    fireEvent.change(screen.getByLabelText("Search events"), {
      target: { value: "lunch" },
    });
    expect(props.onTextChange).toHaveBeenCalledWith("lunch");
  });

  it("forwards priority changes", () => {
    const { props } = renderBar();
    fireEvent.change(screen.getByLabelText("Filter by priority"), {
      target: { value: "critical" },
    });
    expect(props.onPriorityChange).toHaveBeenCalledWith("critical");
  });

  it("forwards clearing the priority filter", () => {
    const { props } = renderBar({
      filter: { ...EMPTY_FILTER, priority: "low" },
    });
    fireEvent.change(screen.getByLabelText("Filter by priority"), {
      target: { value: "" },
    });
    expect(props.onPriorityChange).toHaveBeenCalledWith(null);
  });

  it("forwards tag changes", () => {
    const { props } = renderBar({ tags: ["health", "social"] });
    fireEvent.change(screen.getByLabelText("Filter by tag"), {
      target: { value: "health" },
    });
    expect(props.onTagChange).toHaveBeenCalledWith("health");
  });

  it("forwards month changes", () => {
    const { props } = renderBar({ months: ["2026-09", "2026-10"] });
    fireEvent.change(screen.getByLabelText("Filter by month"), {
      target: { value: "2026-10" },
    });
    expect(props.onMonthChange).toHaveBeenCalledWith("2026-10");
  });

  it("renders the available tag and month options", () => {
    renderBar({ tags: ["health"], months: ["2026-09"] });
    expect(screen.getByRole("option", { name: "health" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2026-09" })).toBeInTheDocument();
  });

  it("clears filters on Escape in the search box and blurs", () => {
    const { props } = renderBar();
    const input = screen.getByLabelText("Search events");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onClear).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });

  it("shows a Clear button only when there are tag/month options", () => {
    const { view } = renderBar({ tags: ["health"] });
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    view.unmount();

    renderBar();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });
});
