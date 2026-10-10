import { useTheme } from "../theme/useTheme";
import { nextTheme, themeLabel } from "../../core/theme";
import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";

/**
 * The dark/light theme toggle (issue #48).
 *
 * A thin, dumb component: it consumes the injected theme state via `useTheme()`
 * and renders a 40px square ghost button (`btn-ghost btn-square`) that toggles
 * between light and dark. The Sun/Moon icons cross-fade and rotate on toggle.
 * All derivation (toggle step, label) lives in `src/core/theme`; no business
 * logic lives here.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const target = nextTheme(theme);
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${themeLabel(target)} theme`}
      title={`Switch to ${themeLabel(target)} theme`}
      className="btn-ghost btn-square relative overflow-hidden"
    >
      <SunIcon
        aria-hidden
        className={`absolute h-5 w-5 transition-all duration-300 ${
          isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"
        }`}
      />
      <MoonIcon
        aria-hidden
        className={`absolute h-5 w-5 transition-all duration-300 ${
          isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        }`}
      />
    </button>
  );
}
