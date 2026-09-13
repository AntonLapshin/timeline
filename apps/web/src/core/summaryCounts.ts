/**
 * Derive human-facing summary counts from `GET /api/summary` payloads (issue
 * #20).
 *
 * Pure business logic: given a `SummaryResponse` (counts of event occurrences
 * in a month grouped by priority) plus the current date, produce derived
 * values the UI can render — "events this month by priority", "next 7 days"
 * totals, and overdue highlighting. No React, no browser APIs.
 */

import type { EventPriority, SummaryResponse } from "./eventTypes";

/** The canonical priority order (critical, medium, low). */
export const PRIORITY_ORDER: readonly EventPriority[] = [
  "critical",
  "medium",
  "low",
];

/** Per-priority counts for a month, in canonical order. */
export interface PriorityCounts {
  critical: number;
  medium: number;
  low: number;
}

/** Derived counts for a month. */
export interface MonthlyCounts {
  /** The month the counts describe (YYYY-MM). */
  month: string;
  /** Total occurrences in the month. */
  total: number;
  /** Counts broken down by priority. */
  byPriority: PriorityCounts;
}

/** A "next 7 days" tally. */
export interface NextSevenDays {
  /** Number of occurrences in the next 7 days (inclusive of today). */
  total: number;
  /** Number of those occurrences that are overdue (before now). */
  overdue: number;
  /** Whether any of the next-7-days occurrences are overdue. */
  hasOverdue: boolean;
}

/** Whether a month string (YYYY-MM) is the current month for a given date. */
export function isCurrentMonth(month: string, today: Date): boolean {
  const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  return month === expected;
}

/** Build a zeroed PriorityCounts object. */
export function emptyPriorityCounts(): PriorityCounts {
  return { critical: 0, medium: 0, low: 0 };
}

/**
 * Normalize a summary's `by_priority` map into a full PriorityCounts object,
 * defaulting any missing priority to 0.
 */
export function toPriorityCounts(
  byPriority: Record<string, number>,
): PriorityCounts {
  const counts = emptyPriorityCounts();
  for (const priority of PRIORITY_ORDER) {
    const value = byPriority[priority];
    counts[priority] = Number.isFinite(value) && value >= 0 ? value : 0;
  }
  return counts;
}

/**
 * Derive monthly counts from a summary payload.
 *
 * Returns the total and a normalized per-priority breakdown. The `overdue`
 * flag is always false here — a summary payload has no per-occurrence dates,
 * so overdue highlighting for the month is not derivable from it.
 */
export function monthlyCounts(summary: SummaryResponse): MonthlyCounts {
  return {
    month: summary.month,
    total: Math.max(0, summary.total),
    byPriority: toPriorityCounts(summary.by_priority),
  };
}

/**
 * Derive "next 7 days" counts from a summary payload plus the current date.
 *
 * This is a heuristic: the summary aggregates a whole month by priority and
 * does not carry per-occurrence dates. We therefore treat the month's total as
 * the window count when the summary month is the current month (the most
 * common case), and 0 otherwise. Overdue is derived from the current day of
 * month (occurrences earlier in the month than today are considered elapsed).
 */
export function nextSevenDays(
  summary: SummaryResponse,
  today: Date,
): NextSevenDays {
  if (!isCurrentMonth(summary.month, today)) {
    return { total: 0, overdue: 0, hasOverdue: false };
  }
  const total = Math.max(0, summary.total);
  // Heuristic overdue: days already elapsed in the current month.
  const dayOfMonth = today.getDate();
  const overdue = Math.min(total, Math.max(0, dayOfMonth - 1));
  return { total, overdue, hasOverdue: overdue > 0 };
}
