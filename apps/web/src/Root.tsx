import App from "./App";
import { ShowcasePage } from "./ui/showcase/ShowcasePage";
import { isShowcaseLocation } from "./core/showcaseRoute";

/**
 * The app root (issue #56).
 *
 * Renders the normal app, or the dev-only component Showcase gallery when the
 * URL requests it — see `isShowcaseLocation` in `src/core/showcaseRoute` for
 * the accepted forms (`?showcase`, `#showcase`, `/showcase`). The gallery
 * injects its own fake services via context, so it runs with no backend.
 * This is dev tooling only; the normal production app is unchanged.
 */
export function Root() {
  const isShowcase = isShowcaseLocation(
    window.location.search,
    window.location.hash,
    window.location.pathname,
  );
  return isShowcase ? <ShowcasePage /> : <App />;
}
