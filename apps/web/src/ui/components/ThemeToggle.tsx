import { useTheme } from "../theme/useTheme";
import { nextTheme, themeLabel } from "../../core/theme";
import { Button } from "./Button";
import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";

/**
 * The dark/light theme toggle (issue #48).
 *
 * A thin, dumb component: it consumes the injected theme state via `useTheme()`
 * and renders a square icon button that toggles between light and dark. All
 * derivation (toggle step, label) lives in `src/core/theme`; no business
 * logic lives here.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const target = nextTheme(theme);
  const Icon = theme === "dark" ? SunIcon : MoonIcon;
  return (
    <Button
      variant="ghost"
      square
      onClick={toggle}
      aria-label={`Switch to ${themeLabel(target)} theme`}
      title={`Switch to ${themeLabel(target)} theme`}
    >
      <Icon aria-hidden className="h-4 w-4" />
    </Button>
  );
}
