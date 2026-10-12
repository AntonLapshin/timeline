import { useCallback } from "react";
import {
  useStateInUrl,
  useBatchUpdate as useLibBatchUpdate,
  type Param,
} from "use-state-in-url";
import { navigateUrl, useUrlLocation } from "./urlLocation";
import type { SearchParams } from "use-state-in-url";

/**
 * `use-state-in-url` wrapper for this app (no react-router here).
 *
 * Supplies the history-backed `{ location, navigate }` pair from
 * `urlLocation.ts` so callers only pass the param config:
 *
 * ```ts
 * const [view, setView] = useUrlState({ name: "view", defaultValue: "timeline" });
 * ```
 *
 * Returns `[value, setValue, updaterFor]` — `updaterFor(value)` builds a
 * single-param updater for `batchUpdate` (see `useUrlBatchUpdate`), so
 * several params can change in one history entry.
 *
 * Options:
 * - `replace: true` — replace the history entry instead of pushing (for
 *   high-frequency updates like search-as-you-type, so the back button does
 *   not step through every keystroke).
 *
 * String encoding note: the library writes string params to the URL
 * unencoded, so a raw value containing `&`, `=` or `#` would corrupt the
 * query string. String values are therefore `encodeURIComponent`'d on write
 * and decoded on read via {@link safeDecodeUrlValue}; the caller always sees
 * the raw value. Non-string params (number / boolean) go through untouched.
 */
export interface UseUrlStateOptions {
  /**
   * Replace the current history entry instead of pushing a new one.
   * Use for high-frequency updates (e.g. search-as-you-type).
   */
  replace?: boolean;
}

/**
 * Decode a URL param value back to its raw form.
 *
 * Accepts the decode only when re-encoding round-trips (i.e. the input was
 * genuinely the encoded form). A raw value that merely contains `%` (or is
 * not valid percent-encoding at all) is returned unchanged instead of
 * throwing or mangling it.
 */
export function safeDecodeUrlValue(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    return encodeURIComponent(decoded) === value ? decoded : value;
  } catch {
    return value;
  }
}

export function useUrlState<T>(
  param: Param<T>,
  options?: UseUrlStateOptions,
): [T, (value: T) => void, (value: T | undefined) => (params: SearchParams) => SearchParams] {
  const location = useUrlLocation();
  const replace = options?.replace ?? false;
  const navigate = useCallback(
    (url: string) => navigateUrl(url, { replace }),
    [replace],
  );

  const isStringParam = typeof param.defaultValue === "string";
  const encode = useCallback(
    (value: T): T =>
      (isStringParam ? encodeURIComponent(value as string) : value) as T,
    [isStringParam],
  );

  const [stored, update, createUpdater] = useStateInUrl(param, {
    location,
    navigate,
  });

  const value =
    isStringParam && typeof stored === "string"
      ? (safeDecodeUrlValue(stored) as T)
      : stored;

  const setValue = useCallback(
    (next: T) => update(encode(next)),
    [update, encode],
  );

  const updaterFor = useCallback(
    (next: T | undefined) =>
      createUpdater(next === undefined ? undefined : encode(next)),
    [createUpdater, encode],
  );

  return [value, setValue, updaterFor];
}

/**
 * Batch several URL-param updates into a single history entry.
 *
 * ```ts
 * const { batchUpdate } = useUrlBatchUpdate();
 * const [, , viewUpdater] = useUrlState(VIEW_PARAM);
 * const [, , dayUpdater] = useUrlState(DAY_PARAM);
 * batchUpdate([viewUpdater("calendar"), dayUpdater(undefined)]);
 * ```
 */
export function useUrlBatchUpdate(): {
  batchUpdate: (
    updates: Array<(params: SearchParams) => SearchParams>,
    options?: { includeExisting?: boolean; path?: string },
  ) => void;
} {
  const location = useUrlLocation();
  const navigate = useCallback((url: string) => navigateUrl(url), []);
  return useLibBatchUpdate({ location, navigate });
}

/** Re-exported for param-type declarations in view models. */
export type { Param };
