import type { Param } from "./useUrlState";

/**
 * The app's deep-link query params (see `useUrlState`).
 *
 * Every piece of primary UI state is reflected in the URL so views are
 * shareable and back/forward-aware:
 *
 * - `view` — top-level view (`timeline` | `calendar`)
 * - `q`, `priority`, `tag`, `fmonth` — search text + filter dropdowns
 * - `new` — the create-event modal (`true` = open)
 * - `edit` — the edit-event modal (event id; `0`/absent = closed)
 * - `event` — the event drawer (event id; `0`/absent = closed)
 * - `cal` — calendar sub-mode (`month` | `week` | `agenda`)
 * - `month` — calendar visible month (`YYYY-MM`; absent = current month)
 * - `week` — calendar visible week anchor (`YYYY-MM-DD`; absent = current week)
 * - `day` — calendar day-drawer selection (`YYYY-MM-DD`; absent = closed)
 *
 * Defaults are chosen so the "clean" URL (`/`) is the default app state and
 * params only appear once the user deviates from it.
 */

/** `?view=calendar` — the top-level view (default `timeline`). */
export const VIEW_PARAM: Param<string> = { name: "view", defaultValue: "timeline" };

/** `?q=...` — the free-text search query (default `""`). */
export const SEARCH_TEXT_PARAM: Param<string> = { name: "q", defaultValue: "" };

/** `?priority=critical` — the priority filter (default `""` = all). */
export const FILTER_PRIORITY_PARAM: Param<string> = {
  name: "priority",
  defaultValue: "",
};

/** `?tag=...` — the tag filter (default `""` = all). */
export const FILTER_TAG_PARAM: Param<string> = { name: "tag", defaultValue: "" };

/** `?fmonth=2026-10` — the month filter (default `""` = all). */
export const FILTER_MONTH_PARAM: Param<string> = { name: "fmonth", defaultValue: "" };

/** `?new=true` — the create-event modal is open (default `false`). */
export const NEW_MODAL_PARAM: Param<boolean> = { name: "new", defaultValue: false };

/** `?edit=123` — the edit-event modal is open for this event id (`0` = closed). */
export const EDIT_MODAL_PARAM: Param<number> = { name: "edit", defaultValue: 0 };

/** `?event=123` — the event drawer is open for this event id (`0` = closed). */
export const EVENT_PARAM: Param<number> = { name: "event", defaultValue: 0 };

/** `?cal=week` — the calendar sub-mode (default `month`). */
export const CAL_MODE_PARAM: Param<string> = { name: "cal", defaultValue: "month" };

/** `?month=2026-10` — the calendar's visible month (absent = current month). */
export const CAL_MONTH_PARAM: Param<string> = { name: "month", defaultValue: "" };

/** `?week=2026-10-12` — the calendar's visible week anchor date (absent = current week). */
export const CAL_WEEK_PARAM: Param<string> = { name: "week", defaultValue: "" };

/** `?day=2026-10-12` — the calendar day-drawer selection (absent = closed). */
export const CAL_DAY_PARAM: Param<string> = { name: "day", defaultValue: "" };

/**
 * Params cleared by the "home" navigation (logo click): the view, the
 * calendar position, and any transient UI (drawers, modals). Search/filter
 * params are deliberately kept — they are user data, not navigation.
 */
export const HOME_RESET_PARAMS: readonly string[] = [
  VIEW_PARAM.name,
  CAL_MODE_PARAM.name,
  CAL_MONTH_PARAM.name,
  CAL_WEEK_PARAM.name,
  CAL_DAY_PARAM.name,
  EVENT_PARAM.name,
  NEW_MODAL_PARAM.name,
  EDIT_MODAL_PARAM.name,
];
