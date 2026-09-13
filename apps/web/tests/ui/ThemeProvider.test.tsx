import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/ui/theme/ThemeProvider";
import { createMemoryThemeStorage } from "../../src/adapters/themeStorage";
import { useTheme } from "../../src/ui/theme/useTheme";
import { DEFAULT_THEME } from "../../src/core/theme";

/** A probe component that surfaces the theme context value for assertions. */
function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button type="button" onClick={toggle}>
        toggle
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("provides the persisted theme on mount", () => {
    render(
      <ThemeProvider storage={createMemoryThemeStorage("dark")}>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme-value")).toHaveTextContent("dark");
  });

  it("defaults to the core default theme when storage has no value", () => {
    render(
      <ThemeProvider storage={createMemoryThemeStorage()}>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme-value")).toHaveTextContent(DEFAULT_THEME);
  });

  it("toggles between light and dark", () => {
    render(
      <ThemeProvider storage={createMemoryThemeStorage("light")}>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme-value")).toHaveTextContent("light");
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("theme-value")).toHaveTextContent("dark");
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("theme-value")).toHaveTextContent("light");
  });

  it("persists the theme to storage on change", () => {
    const storage = createMemoryThemeStorage("light");
    render(
      <ThemeProvider storage={storage}>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(storage.get()).toBe("dark");
  });

  it("applies the theme to the document on mount and change", () => {
    const apply = vi.fn();
    render(
      <ThemeProvider storage={createMemoryThemeStorage("light")} apply={apply}>
        <Probe />
      </ThemeProvider>,
    );
    expect(apply).toHaveBeenLastCalledWith("light");
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(apply).toHaveBeenLastCalledWith("dark");
  });
});
