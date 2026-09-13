import { useContext } from "react";
import { ThemeContext, type ThemeState } from "./context";

/**
 * Access the injected theme state. Must be called within a `ThemeProvider`.
 */
export function useTheme(): ThemeState {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return theme;
}
