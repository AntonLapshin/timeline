/**
 * Create/edit event wizard logic (issue #39).
 *
 * Pure business logic for the 3-step wizard (What/When → Recurrence →
 * Priority & Reminders): holds a mutable draft, validates each step (so an
 * incomplete event can't be submitted), derives the recurrence rule the API
 * expects (RFC 5545 RRULE), builds the create/update payloads, and pre-fills a
 * draft from an existing event for edit mode. No React, no browser APIs — only
 * data transformation.
 */

import { parseIso, toLocalDate } from "./dateFmt";
import type {
  EventChannel,
  EventCreate,
  EventPriority,
  EventRead,
  EventUpdate,
} from "./eventTypes";

/** The three wizard steps, in order. */
export type WizardStep = 1 | 2 | 3;

/** The recurrence choices offered by Step 2. */
export type RecurrenceChoice =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom";

/** All recurrence choices in display order. */
export const RECURRENCE_CHOICES: readonly RecurrenceChoice[] = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "custom",
];

/** All valid reminder-offset presets offered by Step 3 (shared schema format). */
export const REMINDER_OFFSET_PRESETS: readonly string[] = [
  "7d",
  "1d",
  "2h",
];

/** The working draft of an event being created or edited. */
export interface EventDraft {
  /** Event title (required). */
  title: string;
  /** Event notes / description. */
  notes: string;
  /** Whether the event is all-day (no time). */
  allDay: boolean;
  /** The event's calendar date as YYYY-MM-DD (required). */
  date: string;
  /** The event's start time as HH:MM (required unless all-day). */
  time: string;
  /** The event's IANA timezone. */
  tz: string;
  /** The chosen recurrence. */
  recurrence: RecurrenceChoice;
  /** A custom RRULE string, used only when recurrence is "custom". */
  customRrule: string;
  /** The event priority. */
  priority: EventPriority;
  /** The reminder delivery channels. */
  channels: EventChannel[];
  /** The reminder offsets (shared schema format, e.g. "7d"). */
  reminderOffsets: string[];
}

/** Per-field validation errors for a draft (undefined means the field is valid). */
export interface DraftErrors {
  title?: string;
  date?: string;
  time?: string;
  customRrule?: string;
}

/** The default timezone label used when the local zone can't be resolved. */
export const DEFAULT_TZ = "UTC";

/** Pad a number to two digits (e.g. 9 → "09"). */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date's time as HH:MM. */
function timeOf(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * A sensible default timezone label for a given local date.
 *
 * Uses the runtime's IANA timezone name when available, falling back to the
 * offset (e.g. "UTC+03:00") and finally to `DEFAULT_TZ`.
 */
export function localTimezone(date: Date): string {
  const tz = date.getTimezoneOffset();
  try {
    const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (name) {
      return name;
    }
  } catch {
    // fall through to the offset-based label
  }
  if (tz === 0) {
    return DEFAULT_TZ;
  }
  const sign = tz > 0 ? "-" : "+";
  const abs = Math.abs(tz);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** Build an empty draft, defaulting date/time/tz to "now". */
export function emptyDraft(now: Date = new Date()): EventDraft {
  return {
    title: "",
    notes: "",
    allDay: false,
    date: toLocalDate(now),
    time: timeOf(now),
    tz: localTimezone(now),
    recurrence: "none",
    customRrule: "",
    priority: "medium",
    channels: ["telegram"],
    reminderOffsets: [],
  };
}

/** Map an event's RRULE to the closest recurrence choice. */
export function recurrenceChoiceFromRrule(
  rrule: string | null | undefined,
): RecurrenceChoice {
  if (!rrule) {
    return "none";
  }
  const freqMatch = /(?:^|;)FREQ=([A-Z]+)/.exec(rrule);
  const freq = freqMatch ? freqMatch[1] : null;
  const intervalMatch = /(?:^|;)INTERVAL=([0-9]+)/.exec(rrule);
  const interval = intervalMatch ? intervalMatch[1] : null;
  switch (freq) {
    case "DAILY":
      return "daily";
    case "WEEKLY":
      return "weekly";
    case "MONTHLY":
      return interval === "3" ? "quarterly" : "monthly";
    case "YEARLY":
      return "yearly";
    default:
      return "custom";
  }
}

/**
 * Pre-fill a draft from an existing event, for edit mode.
 *
 * The time is blanked for all-day events; the recurrence choice is derived
 * from the event's RRULE, with an unrecognized rule kept as the custom RRULE.
 */
export function draftFromEvent(event: EventRead): EventDraft {
  const start = parseIso(event.start_at);
  const recurrence = recurrenceChoiceFromRrule(event.rrule);
  return {
    title: event.title,
    notes: event.description,
    allDay: event.all_day,
    date: start ? toLocalDate(start) : "",
    time: event.all_day || !start ? "" : timeOf(start),
    tz: event.tz || DEFAULT_TZ,
    recurrence,
    customRrule: event.rrule ?? "",
    priority: event.priority,
    channels: event.channels.length ? event.channels : ["telegram"],
    reminderOffsets: event.reminder_offsets,
  };
}

/** Validate a draft and return per-field errors. */
export function validateDraft(draft: EventDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.title.trim()) {
    errors.title = "Title is required";
  }
  if (!draft.date) {
    errors.date = "Date is required";
  }
  if (!draft.allDay && !draft.time) {
    errors.time = "Time is required";
  }
  if (draft.recurrence === "custom" && !draft.customRrule.trim()) {
    errors.customRrule = "Recurrence rule is required";
  }
  return errors;
}

/** The errors relevant to a single step (later steps are not checked yet). */
export function stepErrors(step: WizardStep, draft: EventDraft): DraftErrors {
  const all = validateDraft(draft);
  const relevant =
    step === 1
      ? { title: all.title, date: all.date, time: all.time }
      : step === 2
        ? { customRrule: all.customRrule }
        : {};
  const errors: DraftErrors = {};
  for (const [key, value] of Object.entries(relevant)) {
    if (value !== undefined) {
      (errors as Record<string, string>)[key] = value;
    }
  }
  return errors;
}

/** Whether the user may advance from a given step (its fields are complete). */
export function canGoNext(step: WizardStep, draft: EventDraft): boolean {
  return Object.keys(stepErrors(step, draft)).length === 0;
}

/** The next step after `step` (2 → 3 → 3, i.e. clamped at the end). */
export function nextStep(step: WizardStep): WizardStep {
  return step === 3 ? 3 : ((step + 1) as WizardStep);
}

/** The previous step before `step` (2 → 1 → 1, i.e. clamped at the start). */
export function prevStep(step: WizardStep): WizardStep {
  return step === 1 ? 1 : ((step - 1) as WizardStep);
}

/** Derive the RFC 5545 RRULE for a choice (null = one-time event). */
export function rruleForChoice(
  recurrence: RecurrenceChoice,
  customRrule: string,
): string | null {
  switch (recurrence) {
    case "none":
      return null;
    case "daily":
      return "FREQ=DAILY";
    case "weekly":
      return "FREQ=WEEKLY";
    case "monthly":
      return "FREQ=MONTHLY";
    case "quarterly":
      return "FREQ=MONTHLY;INTERVAL=3";
    case "yearly":
      return "FREQ=YEARLY";
    case "custom":
      return customRrule.trim() ? customRrule.trim() : null;
  }
}

/**
 * Build the event's start_at ISO timestamp from the draft.
 *
 * All-day events start at local midnight of `date`; timed events use
 * `date` + `time`. Falls back to midnight when the time is missing.
 */
export function draftStartAt(draft: EventDraft): string {
  const time = draft.allDay || !draft.time ? "00:00" : draft.time;
  return `${draft.date}T${time}:00`;
}

/** Build the `POST /api/events` payload from a completed draft. */
export function buildCreatePayload(draft: EventDraft): EventCreate {
  const rrule = rruleForChoice(draft.recurrence, draft.customRrule);
  return {
    title: draft.title.trim(),
    description: draft.notes,
    type: rrule ? "recurrent" : "one_time",
    start_at: draftStartAt(draft),
    end_at: null,
    all_day: draft.allDay,
    tz: draft.tz,
    rrule,
    priority: draft.priority,
    channels: draft.channels,
    reminder_offsets: draft.reminderOffsets,
    source: "web",
    status: "active",
  };
}

/**
 * Build the `PATCH /api/events/{id}` payload from a completed draft.
 *
 * Includes every wizard-managed field so an edit fully reflects the draft
 * (including explicitly clearing `rrule` when the user chose "none").
 */
export function buildUpdatePayload(draft: EventDraft): EventUpdate {
  const rrule = rruleForChoice(draft.recurrence, draft.customRrule);
  return {
    title: draft.title.trim(),
    description: draft.notes,
    type: rrule ? "recurrent" : "one_time",
    start_at: draftStartAt(draft),
    end_at: null,
    all_day: draft.allDay,
    tz: draft.tz,
    rrule,
    priority: draft.priority,
    channels: draft.channels,
    reminder_offsets: draft.reminderOffsets,
  };
}
