/**
 * LLM smart-input parsing service for the timeline web UI (issue #20).
 *
 * Pure service: wraps `fetch` (injected as a dependency) into a typed call to
 * `POST /api/events/parse`, which returns a structured event draft to be
 * confirmed before saving. The endpoint itself is implemented in a later
 * milestone; this module defines the contract the UI consumes. No React, no
 * browser globals.
 */

import { safePriority, validateDraft, type ParsedDraft } from "./parseGuards";
import {
  DEFAULT_TZ,
  recurrenceChoiceFromRrule,
  type EventDraft,
} from "./eventWizard";
import type { EventPriority } from "./eventTypes";
import { parseIso, toLocalDate } from "./dateFmt";
import { ApiError, type FetchLike } from "./apiClient";

/** Result of a parse call: either a draft or an error message. */
export type ParseResult =
  | { ok: true; draft: ParsedDraft }
  | {
      ok: false;
      error: string;
      /** True when the LLM key is absent / parsing is unavailable. */
      unavailable?: boolean;
    };

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
export interface LlmParser {
  parse(text: string): Promise<ParseResult>;
}

/**
 * Build an LlmParser.
 *
 * @param baseUrl  The API base URL, e.g. `http://127.0.0.1:8123`.
 * @param fetchImpl  The fetch implementation to use (defaults to globalThis.fetch).
 */
export function createLlmParser(
  baseUrl: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): LlmParser {
  const base = baseUrl.replace(/\/+$/, "");

  return {
    async parse(text: string): Promise<ParseResult> {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetchImpl(`${base}/api/events/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } catch {
        return { ok: false, error: "network error while parsing" };
      }
      if (res.status === 503) {
        // The LLM key is absent — parsing is unavailable, not a hard failure.
        return {
          ok: false,
          unavailable: true,
          error:
            "Parsing is unavailable (LLM key not configured). You can still add the event manually.",
        };
      }
      if (!res.ok) {
        throw new ApiError(res.status, `API parse failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as ParsedDraft;
      return { ok: true, draft: data };
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
  return {
    title: parsed.title ?? "",
    notes: "",
    allDay: parsed.all_day ?? false,
    date: start ? toLocalDate(start) : "",
    time: parsed.all_day || !start ? "" : timeOf(start),
    tz: parsed.tz || DEFAULT_TZ,
    recurrence,
    customRrule: parsed.rrule ?? "",
    priority,
    channels: parsed.channels?.length ? parsed.channels : ["telegram"],
    reminderOffsets: [],
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
