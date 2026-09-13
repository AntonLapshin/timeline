/**
 * Theme (dark/light) business logic (issue #48).
 *
 * Pure, framework-agnostic derivation for the app-wide theme toggle: the set of
 * valid themes, normalization of an arbitrary stored value, the toggle step,
 * and human labels. No React, no Tailwind imports, no browser APIs — only data
 * transformation over plain values, so it stays 100% Vitest-covered.
 */

/** The two supported color themes. */
export type Theme = "light" | "dark";

/** The valid themes, in display order. */
export const THEMES: readonly Theme[] = ["light", "dark"];

/** The theme used when no valid stored value is present. */
export const DEFAULT_THEME: Theme = "light";

/** The localStorage key used to persist the chosen theme. */
export const THEME_STORAGE_KEY = "timeline:theme";

/** Whether an arbitrary value is a valid theme. */
export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Normalize an arbitrary stored value to a valid theme, falling back to
 * `DEFAULT_THEME` for anything that is not a known theme.
 */
export function normalizeTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

/**
 * The theme that results from toggling the given theme (light <-> dark).
 */
export function nextTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}

/** A human-readable label for a theme (used for the toggle's aria-label). */
export function themeLabel(theme: Theme): string {
  return theme === "dark" ? "Dark" : "Light";
}
