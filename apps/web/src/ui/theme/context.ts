import { createContext, type Context } from "react";
import type { Theme } from "../../core/theme";

/** The theme state exposed to the UI via context. */
export interface ThemeState {
  /** The current theme (light or dark). */
  theme: Theme;
  /** Toggle between light and dark. */
  toggle: () => void;
}

/** React context holding the theme state (null until provided). */
export const ThemeContext: Context<ThemeState | null> =
  createContext<ThemeState | null>(null);
