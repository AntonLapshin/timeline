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

/** Open a dropdown trigger and click one of its options by visible label. */
function pickOption(triggerName: string, optionName: string) {
  fireEvent.click(screen.getByRole("button", { name: triggerName }));
  fireEvent.click(screen.getByRole("button", { name: optionName }));
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
    pickOption("Filter by priority", "Critical");
    expect(props.onPriorityChange).toHaveBeenCalledWith("critical");
  });

  it("forwards clearing the priority filter", () => {
    const { props } = renderBar({
      filter: { ...EMPTY_FILTER, priority: "low" },
    });
    pickOption("Filter by priority", "Priority");
    expect(props.onPriorityChange).toHaveBeenCalledWith(null);
  });

  it("forwards tag changes", () => {
    const { props } = renderBar({ tags: ["health", "social"] });
    pickOption("Filter by tag", "health");
    expect(props.onTagChange).toHaveBeenCalledWith("health");
  });

  it("forwards month changes", () => {
    const { props } = renderBar({ months: ["2026-09", "2026-10"] });
    pickOption("Filter by month", "2026-10");
    expect(props.onMonthChange).toHaveBeenCalledWith("2026-10");
  });

  it("renders the available tag and month options", () => {
    renderBar({ tags: ["health"], months: ["2026-09"] });
    fireEvent.click(screen.getByRole("button", { name: "Filter by tag" }));
    expect(screen.getByRole("button", { name: "health" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter by month" }));
    expect(screen.getByRole("button", { name: "2026-09" })).toBeInTheDocument();
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
