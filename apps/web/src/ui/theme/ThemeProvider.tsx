import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeContext } from "./context";
import { nextTheme, type Theme } from "../../core/theme";
import {
  createLocalStorageThemeStorage,
  defaultThemeApplier,
  type ThemeStorage,
} from "../../adapters/themeStorage";

/** A function that applies a theme to the document (e.g. toggling a class). */
export type ThemeApplier = (theme: Theme) => void;

export interface ThemeProviderProps {
  children: ReactNode;
  /**
   * The storage used to persist/restore the theme. Defaults to a
   * `localStorage`-backed storage; tests inject an in-memory one.
   */
  storage?: ThemeStorage;
  /**
   * The applier invoked when the theme changes. Defaults to a class toggle on
   * the document element; tests inject a spy.
   */
  apply?: ThemeApplier;
}

/**
 * Provides the app-wide theme state via context (issue #48).
 *
 * Follows the same context-injection pattern as `ServicesProvider`: the
 * concrete storage/applier implementations are wired here once — components
 * consume the state via `useTheme()` and never touch storage or the DOM
 * directly. All theme derivation (toggle/normalize) lives in `src/core/theme`;
 * this provider only holds state and performs the (impure) persistence/apply.
 */
export function ThemeProvider({
  children,
  storage = createLocalStorageThemeStorage(),
  apply = defaultThemeApplier,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => storage.get());

  const value = useMemo(
    () => ({
      theme,
      toggle: () => setTheme((current) => nextTheme(current)),
    }),
    [theme],
  );

  // Persist and apply whenever the theme changes (including on mount, so an
  // already-persisted dark theme is applied to the document on first load).
  useEffect(() => {
    storage.set(theme);
  }, [theme, storage]);

  useEffect(() => {
    apply(theme);
  }, [theme, apply]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
