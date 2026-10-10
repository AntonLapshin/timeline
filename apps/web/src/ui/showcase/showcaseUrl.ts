/**
 * URL helpers for the Storybook-style Showcase gallery.
 *
 * Selection deep-links via `?showcase&file=Button&story=Variants` — shareable,
 * back/forward aware, and reflected in the document title by the page shell.
 */

/** The gallery selection read from / written to the URL. */
export interface ShowcaseSelection {
  file: string | null;
  story: string | null;
}

/** Reads the gallery selection from `?showcase&file=X&story=Y`. */
export function readSelection(): ShowcaseSelection {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("showcase")) return { file: null, story: null };
  return { file: params.get("file"), story: params.get("story") };
}

/** Builds the deep-link URL for a selection. */
export function selectionUrl(
  file: string | null,
  story: string | null = null,
): string {
  let url = "?showcase";
  if (file) url += `&file=${encodeURIComponent(file)}`;
  if (story) url += `&story=${encodeURIComponent(story)}`;
  return url;
}

/** URL-safe anchor id for a story name. */
export function storySlug(name: string): string {
  return `story-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}
