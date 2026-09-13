/**
 * Format an RFC 5545 recurrence rule into a human-readable label (issue #20).
 *
 * Pure business logic: given an event's `rrule` string (or null for one-time
 * events), produce a short human label like "every quarter", "every 2 weeks",
 * "daily", or "custom". No React, no browser APIs.
 */

/** The set of recurrence frequencies we can render as a known label. */
export type RecurrenceFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

/** A parsed, normalized view of a recurrence rule. */
export interface RecurrenceLabel {
  /** The canonical frequency, or "custom" when the rule is unrecognized. */
  frequency: RecurrenceFrequency | "custom";
  /** The human-readable label. */
  label: string;
  /** Whether the rule was recognized (not free-form / custom). */
  known: boolean;
}

/** Parse the FREQ value from an RFC 5545 rule, if present. */
function freqOf(rrule: string): string | null {
  const match = /(?:^|;)FREQ=([A-Z]+)/.exec(rrule);
  return match ? match[1] : null;
}

/** Parse the INTERVAL value from an RFC 5545 rule, defaulting to 1. */
function intervalOf(rrule: string): number {
  const match = /(?:^|;)INTERVAL=([0-9]+)/.exec(rrule);
  const value = match ? Number(match[1]) : 1;
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/** Map an RFC 5545 FREQ to our canonical frequency (quarterly is derived). */
function canonicalFrequency(
  freq: string,
  interval: number,
): RecurrenceFrequency | "custom" {
  switch (freq) {
    case "DAILY":
      return "daily";
    case "WEEKLY":
      return "weekly";
    case "MONTHLY":
      return interval === 3 ? "quarterly" : "monthly";
    case "YEARLY":
      return "yearly";
    default:
      return "custom";
  }
}

/** Plural unit label for each frequency (quarterly is handled separately). */
const UNITS: Record<Exclude<RecurrenceFrequency, "quarterly">, string> = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
  yearly: "years",
};

/** Build the "every N <unit>" label for a frequency and interval. */
function everyLabel(frequency: RecurrenceFrequency, interval: number): string {
  if (frequency === "quarterly") {
    // Quarterly is only ever derived from a monthly interval of 3.
    return "every quarter";
  }
  if (interval === 1) {
    switch (frequency) {
      case "daily":
        return "daily";
      case "weekly":
        return "every week";
      case "monthly":
        return "every month";
      case "yearly":
        return "every year";
    }
  }
  return `every ${interval} ${UNITS[frequency]}`;
}

/**
 * Format a recurrence rule into a human-readable label.
 *
 * A `null`/empty rule (a one-time event) is labelled "one-time". A rule whose
 * FREQ we don't recognize is labelled "custom". Quarterly is derived from a
 * monthly interval of 3.
 */
export function formatRecurrence(rrule: string | null | undefined): RecurrenceLabel {
  if (!rrule) {
    return { frequency: "custom", label: "one-time", known: false };
  }
  const freq = freqOf(rrule);
  if (!freq) {
    return { frequency: "custom", label: "custom", known: false };
  }
  const interval = intervalOf(rrule);
  const frequency = canonicalFrequency(freq, interval);
  if (frequency === "custom") {
    return { frequency: "custom", label: "custom", known: false };
  }
  return { frequency, label: everyLabel(frequency, interval), known: true };
}
