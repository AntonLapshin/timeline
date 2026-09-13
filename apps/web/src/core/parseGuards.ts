/**
 * Validate and normalize a parsed event draft before it is confirmed (issue
 * #20).
 *
 * Pure business logic: an AI or smart-input parser produces a draft; this
 * module validates its shape, normalizes it, and decides a safe default
 * priority. A critical financial event is never auto-saved with a low/medium
 * priority, and uncertain drafts default to medium. No React, no browser APIs.
 */

import type {
  EventChannel,
  EventPriority,
  EventType,
} from "./eventTypes";

/** A parsed event draft, as produced by `POST /api/events/parse`. */
export interface ParsedDraft {
  title: string;
  priority?: EventPriority;
  type?: EventType;
  start_at?: string;
  all_day?: boolean;
  tz?: string;
  rrule?: string | null;
  channels?: EventChannel[];
  tags?: string[];
}

/**
 * Why a draft was rejected or downgraded. `ok` drafts are safe to confirm;
 * `rejected` drafts must be fixed by the user before saving.
 */
export type GuardResult =
  | { ok: true; draft: ParsedDraft }
  | { ok: false; errors: string[] };

/** A normalized draft with a resolved safe-default priority. */
export interface GuardedDraft {
  draft: ParsedDraft;
  /** The resolved safe-default priority. */
  priority: EventPriority;
  /** Whether the priority was derived (uncertain) rather than explicit. */
  priorityUncertain: boolean;
}

/** Keywords that hint an event is financial (critical by default). */
const FINANCIAL_HINTS = [
  "pay",
  "payment",
  "bill",
  "invoice",
  "rent",
  "mortgage",
  "tax",
  "insurance",
];

/** Keywords that hint an event is low-stakes (safe to default to low). */
const LOW_PRIORITY_HINTS = ["maybe", "series", "idea", "optional", "someday"];

function containsAny(text: string, hints: string[]): boolean {
  const lower = text.toLowerCase();
  return hints.some((hint) => lower.includes(hint));
}

/** Whether a string is a valid ISO-ish date/time value. */
function isPlausibleDate(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  // Accept YYYY-MM-DD or a full ISO timestamp (naive or with offset).
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * Validate a parsed draft, returning a `GuardResult`.
 *
 * - title must be a non-empty string.
 * - start_at, when present, must look like a date.
 * - priority, when present, must be a known priority.
 * - channels, when present, must be known channels.
 */
export function validateDraft(draft: ParsedDraft): GuardResult {
  const errors: string[] = [];
  const title = typeof draft.title === "string" ? draft.title.trim() : "";
  if (!title) {
    errors.push("title is required");
  }
  if (draft.start_at !== undefined && !isPlausibleDate(draft.start_at)) {
    errors.push("start_at must be a valid date");
  }
  if (
    draft.priority !== undefined &&
    !["critical", "medium", "low"].includes(draft.priority)
  ) {
    errors.push("priority must be critical, medium, or low");
  }
  if (draft.channels !== undefined) {
    for (const channel of draft.channels) {
      if (!["telegram", "email"].includes(channel)) {
        errors.push(`unknown channel: ${channel}`);
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, draft: { ...draft, title } };
}

/**
 * Decide a safe-default priority for a validated draft.
 *
 * Rules:
 * - A financial hint always yields `critical` (never auto-downgraded).
 * - A `maybe`/`series`/`idea` hint yields `low`.
 * - An explicit priority is respected unless it would dangerous for a
 *   financial event (financial is never below critical).
 * - Otherwise default to `medium` (uncertain).
 */
export function safePriority(draft: ParsedDraft): GuardedDraft {
  const title = (draft.title ?? "").toLowerCase();
  const financial = containsAny(title, FINANCIAL_HINTS);
  if (financial) {
    return { draft, priority: "critical", priorityUncertain: false };
  }
  const lowHint = containsAny(title, LOW_PRIORITY_HINTS);
  if (lowHint) {
    return { draft, priority: "low", priorityUncertain: false };
  }
  if (draft.priority !== undefined) {
    return { draft, priority: draft.priority, priorityUncertain: false };
  }
  return { draft, priority: "medium", priorityUncertain: true };
}

/**
 * Guard a parsed draft end-to-end: validate it, then resolve a safe priority.
 * Returns `null` when the draft is invalid (caller should surface errors).
 */
export function guardDraft(draft: ParsedDraft): GuardedDraft | null {
  const validated = validateDraft(draft);
  if (!validated.ok) {
    return null;
  }
  return safePriority(validated.draft);
}
