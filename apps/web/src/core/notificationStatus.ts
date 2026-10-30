/**
 * Notification-state derivation for past event occurrences.
 *
 * Pure business logic behind the event-card highlight: a past occurrence is
 * tinted green when its reminder was sent and acknowledged, orange when it
 * was sent but not acknowledged, and red when no reminder went out at all.
 * No React, no browser APIs — only data transformation over `DeliveryLog`
 * rows.
 */

import type { DeliveryLog } from "./eventTypes";
import {
  parseIso,
  parseNaiveWallClock,
  toDateInTimezone,
  toLocalDate,
} from "./dateFmt";
import { wallToUtcMs } from "./recurrence";

/**
 * Notification state of a single past occurrence.
 *
 * - `"acked"` — at least one delivery was acknowledged.
 * - `"sent"` — at least one delivery was sent (or snoozed) but none acked.
 * - `"unsent"` — nothing was ever sent (only scheduled/failed/deleted rows,
 *   or no rows at all, e.g. the event has no reminders configured).
 */
export type NotificationStatus = "acked" | "sent" | "unsent";

/** Delivery statuses that count as "a notification went out". */
const SENT_STATUSES: ReadonlySet<string> = new Set(["sent", "snoozed"]);

/**
 * Derive the notification status from an occurrence's delivery-log rows.
 *
 * Precedence: acknowledged beats sent beats unsent. `failed` counts as
 * unsent (the notification never went out); `scheduled` rows for a past
 * occurrence likewise mean nothing was delivered.
 */
export function notificationStatusFromLogs(
  logs: readonly DeliveryLog[],
): NotificationStatus {
  let sent = false;
  for (const log of logs) {
    if (log.status === "acked") {
      return "acked";
    }
    if (SENT_STATUSES.has(log.status)) {
      sent = true;
    }
  }
  return sent ? "sent" : "unsent";
}

/**
 * Whether an occurrence lies in the past.
 *
 * All-day occurrences count as past once their local date is before today;
 * timed occurrences once their start instant has passed. Unparseable input
 * is never past.
 */
export function isPastOccurrence(
  startIso: string,
  allDay: boolean,
  now: Date = new Date(),
): boolean {
  if (allDay) {
    const day = startIso.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return false;
    }
    return day < toLocalDate(now);
  }
  const start = parseIso(startIso);
  if (!start) {
    return false;
  }
  return start.getTime() < now.getTime();
}

/**
 * The occurrence's local date (`YYYY-MM-DD`) in the event's timezone.
 *
 * Naive timestamps are already wall-clock in the event's zone, so their date
 * prefix is used verbatim; aware timestamps are converted into the zone via
 * `Intl`. Returns null when the timestamp cannot be parsed.
 */
export function occurrenceLocalDate(
  startIso: string,
  tz: string,
): string | null {
  const trimmed = startIso.trim();
  if (parseNaiveWallClock(trimmed)) {
    const day = trimmed.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  }
  const start = parseIso(trimmed);
  if (!start) {
    return null;
  }
  return toDateInTimezone(start, tz);
}

/**
 * The occurrence start as a UTC instant (ms).
 *
 * Naive timestamps are interpreted as wall-clock in the event's timezone
 * (falling back to `Date.parse` when the zone is unusable); aware timestamps
 * parse directly. Returns null when the timestamp cannot be parsed.
 */
function occurrenceInstantMs(startIso: string, tz: string): number | null {
  const trimmed = startIso.trim();
  const wall = parseNaiveWallClock(trimmed);
  if (wall && tz) {
    const ms = wallToUtcMs({ ...wall, second: 0 }, tz);
    if (ms !== null) {
      return ms;
    }
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/** Suffix markers the backend appends for repeat/snooze follow-up deliveries. */
const OCCURRENCE_SUFFIX_MARKERS = ["~repeat@", "~snooze@"] as const;

/**
 * Strip any repeat/snooze follow-up suffix from an occurrence id, returning
 * the base occurrence the follow-up traces back to. Mirrors the backend's
 * `base_occurrence_id` so ack/state lookups stay consistent.
 */
export function stripOccurrenceSuffix(occurrenceId: string): string {
  for (const marker of OCCURRENCE_SUFFIX_MARKERS) {
    const idx = occurrenceId.indexOf(marker);
    if (idx >= 0) {
      return occurrenceId.slice(0, idx);
    }
  }
  return occurrenceId;
}

/**
 * Whether a delivery-log row targets the given occurrence.
 *
 * The backend keys `DeliveryLog.occurrence_id` as the local date
 * (`YYYY-MM-DD`) for all-day occurrences and as a UTC ISO instant for timed
 * ones. Rows without an occurrence id are treated as applying (single-shot
 * events whose scheduler rows carry no occurrence). Repeat-until-ack and
 * snooze follow-ups use suffixed ids (`<base>~repeat@…`, `<base>~snooze@…`)
 * so their dedupe keys don't collide — the suffix is stripped before
 * matching so follow-ups trace back to their base occurrence.
 */
export function logAppliesToOccurrence(
  log: DeliveryLog,
  startIso: string,
  tz: string,
): boolean {
  const rawId = log.occurrence_id?.trim() ?? "";
  if (rawId === "") {
    return true;
  }
  const occurrenceId = stripOccurrenceSuffix(rawId);
  if (/^\d{4}-\d{2}-\d{2}$/.test(occurrenceId)) {
    return occurrenceLocalDate(startIso, tz) === occurrenceId;
  }
  const logTime = Date.parse(occurrenceId);
  const rowTime = occurrenceInstantMs(startIso, tz);
  return (
    Number.isFinite(logTime) &&
    rowTime !== null &&
    Math.abs(logTime - rowTime) < 60_000
  );
}

/** Keep only the delivery-log rows that target the given occurrence. */
export function logsForOccurrence(
  logs: readonly DeliveryLog[],
  startIso: string,
  tz: string,
): DeliveryLog[] {
  return logs.filter((log) => logAppliesToOccurrence(log, startIso, tz));
}

/**
 * The notification status of the most recently delivered occurrence.
 *
 * Delivery rows are grouped by their (suffix-stripped) occurrence id and
 * the group with the newest delivery timestamp wins; the status is derived
 * from that group alone. This is what the event drawer falls back to when
 * it was opened for the event as a whole rather than for one occurrence:
 * deriving the chip from *all* rows (the previous behaviour) let the very
 * first occurrence's "sent — not acknowledged" row dominate the chip
 * forever, hiding that a later occurrence was never sent at all (or was
 * acknowledged). With a single occurrence this is identical to
 * `notificationStatusFromLogs`; with several, the first occurrence no
 * longer speaks for the whole series.
 */
export function notificationStatusForLatestOccurrence(
  logs: readonly DeliveryLog[],
): NotificationStatus {
  if (logs.length === 0) {
    return "unsent";
  }
  const groups = new Map<string, { logs: DeliveryLog[]; latestMs: number }>();
  for (const log of logs) {
    const rawId = log.occurrence_id?.trim() ?? "";
    const key = rawId === "" ? "" : stripOccurrenceSuffix(rawId);
    const rawTime = log.sent_at ?? log.scheduled_at ?? log.created_at;
    const ms = rawTime ? Date.parse(rawTime) : Number.NaN;
    const timeMs = Number.isFinite(ms) ? ms : 0;
    const group = groups.get(key);
    if (group) {
      group.logs.push(log);
      group.latestMs = Math.max(group.latestMs, timeMs);
    } else {
      groups.set(key, { logs: [log], latestMs: timeMs });
    }
  }
  let best: { logs: DeliveryLog[]; latestMs: number } | null = null;
  for (const group of groups.values()) {
    if (best === null || group.latestMs > best.latestMs) {
      best = group;
    }
  }
  return notificationStatusFromLogs(best?.logs ?? []);
}

/**
 * The card highlight for an occurrence, or null when no highlight applies.
 *
 * Only past occurrences are highlighted; future (and present) ones return
 * null so the card keeps its default treatment.
 */
export function notificationStatusForOccurrence(
  logs: readonly DeliveryLog[],
  startIso: string,
  tz: string,
  allDay: boolean,
  now: Date = new Date(),
): NotificationStatus | null {
  if (!isPastOccurrence(startIso, allDay, now)) {
    return null;
  }
  return notificationStatusFromLogs(logsForOccurrence(logs, startIso, tz));
}
