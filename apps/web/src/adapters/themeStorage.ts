/**
 * Theme persistence adapter (issue #48).
 *
 * Impure I/O lives here — reading/writing the chosen theme to `localStorage`.
 * The pure derivation (normalization, toggle) lives in `src/core/theme`; this
 * adapter only bridges those pure values to the browser storage API. All
 * storage access is wrapped in try/catch so a blocked/absent storage never
 * crashes the app (it simply falls back to the default theme).
 */

import {
  DEFAULT_THEME,
  normalizeTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from "../core/theme";

/** A minimal storage contract the theme provider can be injected with. */
export interface ThemeStorage {
  /** Read the persisted theme (normalized to a valid theme). */
  get: () => Theme;
  /** Persist a theme. */
  set: (theme: Theme) => void;
}

/** An in-memory storage (used by tests and as a safe fallback). */
export function createMemoryThemeStorage(
  initial: Theme = DEFAULT_THEME,
): ThemeStorage {
  let value: Theme = initial;
  return {
    get: () => value,
    set: (theme: Theme) => {
      value = theme;
    },
  };
}

/**
 * The default theme applier: toggles the `dark` class on the document element
 * so Tailwind's `darkMode: "class"` variants take effect. Touches the DOM, so
 * it lives here (impure I/O) rather than in core.
 */
export function defaultThemeApplier(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** A `localStorage`-backed storage for the given key. */
export function createLocalStorageThemeStorage(
  key: string = THEME_STORAGE_KEY,
): ThemeStorage {
  return {
    get: () => {
      try {
        return normalizeTheme(window.localStorage.getItem(key));
      } catch {
        return DEFAULT_THEME;
      }
    },
    set: (theme: Theme) => {
      try {
        window.localStorage.setItem(key, theme);
      } catch {
        /* storage unavailable — persistence is best-effort */
      }
    },
  };
}
