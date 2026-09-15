import App from "./App";
import { ShowcasePage } from "./ui/showcase/ShowcasePage";

/**
 * The app root (issue #56).
 *
 * Renders the normal app, or the dev-only component Showcase gallery when the
 * URL carries a `showcase` query (e.g. `/?showcase=1`). The gallery injects
 * its own fake services via context, so it runs with no backend. This is dev
 * tooling only; the normal production app is unchanged.
 */
export function Root() {
  const isShowcase = new URLSearchParams(window.location.search).has("showcase");
  return isShowcase ? <ShowcasePage /> : <App />;
}
