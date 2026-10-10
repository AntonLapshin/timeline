/**
 * Deterministic smart-input parsing service for the timeline web UI.
 *
 * Pure service: wraps `fetch` (injected as a dependency) into a typed call to
 * `POST /api/events/quick-parse`, which runs the backend's deterministic
 * natural-language parser and returns a structured event draft to be
 * confirmed before saving. The endpoint never 503/502s — the parser is local
 * to the backend, so the worst case for vague text is a today/all-day draft
 * the user corrects on the wizard. Every failure mode maps to a typed,
 * actionable `ParseResult` — this module never throws for HTTP/network
 * failures: network error → cannot-reach-API, any other status →
 * unexpected-API-error, non-object body → unexpected-response. No React, no
 * browser globals.
 */

import { safePriority, validateDraft, type ParsedDraft } from "./parseGuards";
import {
  DEFAULT_TZ,
  recurrenceChoiceFromRrule,
  type EventDraft,
} from "./eventWizard";
import type { EventPriority } from "./eventTypes";
import {
  datePartsInTimezone,
  parseIso,
  parseNaiveWallClock,
  toLocalDate,
} from "./dateFmt";
import type { FetchLike } from "./apiClient";

/** Result of a parse call: either a draft or an error message. */
export type ParseResult =
  | { ok: true; draft: ParsedDraft }
  | { ok: false; error: string };

/** Wire shape of `POST /api/events/quick-parse` (see `QuickParseResponse`). */
interface QuickParseApiResponse {
  draft?: ParsedDraft | null;
  has_explicit_date?: boolean | null;
  has_explicit_time?: boolean | null;
}

/** Fallback when the API returns a body that is not a parse envelope. */
export const UNEXPECTED_BODY_MESSAGE =
  "The API returned an unexpected response. You can still add the event manually.";

/**
 * Normalize a successful `/api/events/quick-parse` body into a `ParseResult`.
 *
 * The API returns an envelope — `{ draft, has_explicit_date, has_explicit_time }`.
 * The explicitness flags stay on the wire: the wizard confirmation is the
 * correction step for vague text. Pure; never throws.
 */
export function parseApiBody(body: unknown): ParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: UNEXPECTED_BODY_MESSAGE };
  }
  const { draft } = body as QuickParseApiResponse;
  if (!draft || typeof draft !== "object") {
    return { ok: false, error: UNEXPECTED_BODY_MESSAGE };
  }
  return { ok: true, draft };
}

/** Message when the API itself cannot be reached (network failure). */
export const NETWORK_ERROR_MESSAGE =
  "Cannot reach the API — check that the backend is running and the address is correct.";

/**
 * Result of converting a parsed draft into a wizard pre-fill.
 *
 * `ok` drafts are ready to open the create wizard for confirmation;
 * `errors` are human-readable reasons the draft could not be used.
 */
export type ParsedToDraftResult =
  | { ok: true; draft: EventDraft }
  | { ok: false; errors: string[] };

/** The parse service bound to a base URL and a fetch implementation. */
export interface QuickParser {
  parse(text: string): Promise<ParseResult>;
}

/**
 * Build a QuickParser.
 *
 * @param baseUrl  The API base URL, e.g. `http://127.0.0.1:8123`.
 * @param fetchImpl  The fetch implementation to use (defaults to globalThis.fetch).
 */
export function createQuickParser(
  baseUrl: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): QuickParser {
  const base = baseUrl.replace(/\/+$/, "");

  return {
    async parse(text: string): Promise<ParseResult> {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetchImpl(`${base}/api/events/quick-parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } catch {
        // The API itself is unreachable.
        return { ok: false, error: NETWORK_ERROR_MESSAGE };
      }
      if (!res.ok) {
        // The deterministic endpoint never 503/502s: any HTTP error is
        // unexpected but must not throw — return a typed result so the UI
        // can render it inline.
        return {
          ok: false,
          error: `Unexpected API error (HTTP ${res.status}). You can still add the event manually.`,
        };
      }
      const data = (await res.json()) as unknown;
      return parseApiBody(data);
    },
  };
}

/** Pad a number to two digits (e.g. 9 → "09"). */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date's time as HH:MM. */
function timeOf(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Convert a parsed draft into a wizard `EventDraft` pre-fill.
 *
 * Maps the parsed fields onto the 3-step wizard's draft (What/When →
 * Recurrence → Priority & Reminders) so the user can confirm before saving.
 * Pure data transformation; no React, no browser APIs.
 *
 * @param parsed  The parsed draft (already validated).
 * @param priority  The resolved safe-default priority (from `guardDraft`).
 */
export function draftFromParsed(
  parsed: ParsedDraft,
  priority: EventPriority = parsed.priority ?? "medium",
): EventDraft {
  const start = parsed.start_at ? parseIso(parsed.start_at) : null;
  const recurrence = recurrenceChoiceFromRrule(parsed.rrule ?? null);
  // Resolve the wall clock in the parsed event's own zone (issue #131): a
  // naive start_at IS that wall clock (render verbatim); an aware one is
  // converted into the zone. Browser-local fallback keeps the old behavior
  // when the parse carries no (valid) zone — showing browser-local time while
  // labeling the draft with the event's zone shifted parsed pre-fills by
  // the zone difference, the same mismatch the drawer/timeline had.
  const wallClock =
    parsed.tz && parsed.start_at ? parseNaiveWallClock(parsed.start_at) : null;
  const parts =
    !wallClock && start && parsed.tz
      ? datePartsInTimezone(start, parsed.tz)
      : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  // Carry valid reminder offsets into the wizard pre-fill so a parsed
  // "notify me 15 minutes in advance" request keeps its reminder instead of
  // silently becoming "No reminders configured".
  const reminderOffsets = Array.isArray(parsed.reminder_offsets)
    ? parsed.reminder_offsets.filter(
        (o): o is string => typeof o === "string" && /^\d+[dhmw]$/.test(o),
      )
    : [];
  return {
    title: parsed.title ?? "",
    notes: "",
    allDay: parsed.all_day ?? false,
    date: start
      ? (wallClock
          ? `${wallClock.year}-${pad(wallClock.month)}-${pad(wallClock.day)}`
          : parts
            ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
            : toLocalDate(start))
      : "",
    time:
      parsed.all_day || !start
        ? ""
        : (wallClock
            ? `${pad(wallClock.hour)}:${pad(wallClock.minute)}`
            : parts
              ? `${pad(parts.hour)}:${pad(parts.minute)}`
              : timeOf(start)),
    tz: parsed.tz || DEFAULT_TZ,
    recurrence,
    customRrule: parsed.rrule ?? "",
    priority,
    channels: parsed.channels?.length ? parsed.channels : ["telegram"],
    reminderOffsets,
  };
}

/**
 * Guard a parsed draft and convert it to a wizard pre-fill.
 *
 * Reuses `parseGuards` to validate the draft and resolve a safe priority, then
 * maps it onto a wizard `EventDraft`. Returns the validation errors when the
 * draft cannot be used (caller should surface them inline).
 */
export function parsedToWizardDraft(parsed: ParsedDraft): ParsedToDraftResult {
  const validated = validateDraft(parsed);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }
  const guarded = safePriority(validated.draft);
  return {
    ok: true,
    draft: draftFromParsed(guarded.draft, guarded.priority),
  };
}
