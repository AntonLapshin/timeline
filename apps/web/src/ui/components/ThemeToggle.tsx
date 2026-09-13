import { useTheme } from "../theme/useTheme";
import { nextTheme, themeLabel } from "../../core/theme";

/**
 * The dark/light theme toggle (issue #48).
 *
 * A thin, dumb component: it consumes the injected theme state via `useTheme()`
 * and renders a button that toggles between light and dark. All derivation
 * (toggle step, label) lives in `src/core/theme`; no business logic lives here.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const target = nextTheme(theme);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${themeLabel(target)} theme`}
      title={`Switch to ${themeLabel(target)} theme`}
      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
