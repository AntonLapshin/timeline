import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// View models backed by `use-state-in-url` (search/filter, wizard, drawer,
// calendar) read `window.location` — reset it before every test so URL state
// never leaks between tests in the same file.
beforeEach(() => {
  window.history.replaceState(null, "", "/");
});
