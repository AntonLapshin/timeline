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
  it("shows a sun (switch to dark) when the theme is light", () => {
    renderToggle("light");
    expect(screen.getByRole("button")).toHaveTextContent("🌙");
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Switch to Dark theme",
    );
  });

  it("shows a moon (switch to light) when the theme is dark", () => {
    renderToggle("dark");
    expect(screen.getByRole("button")).toHaveTextContent("☀️");
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Switch to Light theme",
    );
  });

  it("toggles the theme when clicked", () => {
    renderToggle("light");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("☀️");
  });
});
