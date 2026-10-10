import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SmartInputBox } from "../../src/ui/organisms/SmartInputBox";
import type { SmartInputState } from "../../src/ui/viewModels/useSmartInput";

function state(overrides: Partial<SmartInputState> = {}): SmartInputState {
  return {
    text: "",
    parsing: false,
    error: null,
    setText: vi.fn(),
    submit: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
}

describe("SmartInputBox", () => {
  it("renders the input and Add button", () => {
    render(<SmartInputBox smartInput={state()} />);
    expect(screen.getByLabelText("Add event")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("forwards text changes to the view model", () => {
    const setText = vi.fn();
    render(<SmartInputBox smartInput={state({ setText })} />);
    fireEvent.change(screen.getByLabelText("Add event"), {
      target: { value: "dentist tuesday" },
    });
    expect(setText).toHaveBeenCalledWith("dentist tuesday");
  });

  it("submits on the Add button and prevents default form submission", () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<SmartInputBox smartInput={state({ text: "dentist", submit })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("disables the Add button while parsing or when empty", () => {
    const { rerender } = render(<SmartInputBox smartInput={state({ parsing: true, text: "x" })} />);
    expect(screen.getByRole("button", { name: "Parsing…" })).toBeDisabled();

    rerender(<SmartInputBox smartInput={state({ text: "  " })} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("shows the inline error message with an alert role", () => {
    render(<SmartInputBox smartInput={state({ error: "could not parse" })} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("could not parse");
  });

  it("shows no error when there is none", () => {
    render(<SmartInputBox smartInput={state()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the input while parsing and shows no status line", () => {
    // The parse is a fast local round-trip — the button spinner is the only
    // in-flight indicator; there is no "contacting the AI" status line.
    render(<SmartInputBox smartInput={state({ parsing: true, text: "x" })} />);
    expect(screen.getByLabelText("Add event")).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows no status when idle", () => {
    render(<SmartInputBox smartInput={state()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
