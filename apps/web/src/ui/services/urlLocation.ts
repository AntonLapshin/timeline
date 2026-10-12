import { useSyncExternalStore } from "react";

/**
 * History-backed location for `use-state-in-url` (no react-router in this
 * app).
 *
 * `use-state-in-url` needs a `{ pathname, search }` location object and a
 * `navigate(url)` function. This module provides both on top of the History
 * API: `navigateUrl` pushes (or replaces) a history entry and notifies every
 * mounted `useUrlLocation` hook, and `popstate` (back/forward buttons) is
 * wired once at module level so the URL stays the single source of truth.
 *
 * UI glue only — no business logic. Kept in `ui/services` (not `core`) so
 * the core coverage gate does not apply; it is inherently browser-bound.
 */

/** The minimal location shape `use-state-in-url` consumes. */
export interface UrlLocation {
  pathname: string;
  search: string;
}

/** Options for {@link navigateUrl}. */
export interface NavigateOptions {
  /**
   * Replace the current history entry instead of pushing a new one.
   * Use for high-frequency updates (e.g. search-as-you-type) so the back
   * button does not step through every keystroke.
   */
  replace?: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** Cached snapshot for `useSyncExternalStore` (must be referentially stable). */
let cachedHref: string | null = null;
let cachedLocation: UrlLocation | null = null;

function readLocation(): UrlLocation {
  const href = window.location.href;
  if (cachedLocation === null || cachedHref !== href) {
    cachedHref = href;
    cachedLocation = {
      pathname: window.location.pathname,
      search: window.location.search,
    };
  }
  return cachedLocation;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

let popstateWired = false;

function ensurePopstateWired(): void {
  if (popstateWired) return;
  popstateWired = true;
  window.addEventListener("popstate", emit);
}

function subscribe(listener: Listener): () => void {
  ensurePopstateWired();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Navigate to `url` (a path + query string, e.g. `/?view=calendar`).
 *
 * Pushes a history entry by default so back/forward steps through app state;
 * pass `{ replace: true }` for high-frequency updates. Notifies all mounted
 * `useUrlLocation` hooks synchronously.
 */
export function navigateUrl(url: string, options?: NavigateOptions): void {
  ensurePopstateWired();
  if (options?.replace) {
    window.history.replaceState(null, "", url);
  } else {
    window.history.pushState(null, "", url);
  }
  emit();
}

/**
 * The current history location as a `use-state-in-url`-compatible object.
 *
 * Re-renders the caller on `navigateUrl` and on browser back/forward.
 */
export function useUrlLocation(): UrlLocation {
  return useSyncExternalStore(subscribe, readLocation, readLocation);
}

/**
 * Build a URL with the named query params removed (pure helper for
 * "home"-style links that reset a subset of the URL state).
 */
export function stripUrlParams(search: string, names: readonly string[]): string {
  const params = new URLSearchParams(search);
  for (const name of names) {
    params.delete(name);
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
}
