/**
 * Showcase-route detection (issue #56).
 *
 * Pure helper deciding whether the current location requests the dev-only
 * component Showcase gallery. Accepted forms (all equivalent):
 *   - `/?showcase` or `/?showcase=1` (query flag — the canonical form)
 *   - `/#showcase` or `/#/...showcase...` (hash — survives static hosts that
 *     strip query strings)
 *   - any path ending in `/showcase` (e.g. `/timeline/showcase` on Pages)
 *
 * No browser APIs — only string matching over the location parts.
 */
export function isShowcaseLocation(
  search: string,
  hash: string,
  pathname: string,
): boolean {
  const params = new URLSearchParams(search);
  if (params.has("showcase")) {
    return true;
  }
  if (hash.toLowerCase().includes("showcase")) {
    return true;
  }
  return pathname.toLowerCase().split("/").includes("showcase");
}
