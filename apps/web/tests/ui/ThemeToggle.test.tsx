import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/ui/theme/ThemeProvider";
import { createMemoryThemeStorage } from "../../src/adapters/themeStorage";
import { ThemeToggle } from "../../src/ui/components/ThemeToggle";

function renderToggle(initial: "light" | "dark" = "light") {
  return render(
    <ThemeProvider storage={createMemoryThemeStorage(initial)} apply={() => {}}>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle", () => {
  it("targets the dark theme when the theme is light", () => {
    renderToggle("light");
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-label", "Switch to Dark theme");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("targets the light theme when the theme is dark", () => {
    renderToggle("dark");
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-label", "Switch to Light theme");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("toggles the theme when clicked", () => {
    renderToggle("light");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Switch to Light theme",
    );
  });
});
