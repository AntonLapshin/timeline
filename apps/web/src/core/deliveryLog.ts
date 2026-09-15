/**
 * Delivery-log derivation (issue #63).
 *
 * Pure business logic for the event-drawer delivery log: given the raw
 * `DeliveryLog` rows returned by `GET /api/events/{id}/deliveries`, map each
 * status to a human label + display styling, sort rows newest-first, and
 * derive a renderable row (status label, style, occurrence/offset label and a
 * human timestamp). No React, no browser APIs — only data transformation.
 */

import type { DeliveryLog } from "./eventTypes";
import { parseIso } from "./dateFmt";

/** Display styling for a delivery status. */
export interface DeliveryStatusStyle {
  /** Tailwind text/background color class for the status badge. */
  color: string;
  /** A short glyph used as the status icon. */
  icon: string;
}

/** A fully derived delivery-log row for display. */
export interface DeliveryLogRow {
  /** The underlying delivery-log row. */
  log: DeliveryLog;
  /** Human status label, e.g. "Sent". */
  statusLabel: string;
  /** Status badge styling. */
  statusStyle: DeliveryStatusStyle;
  /** Occurrence + offset label, e.g. "1d before · occ-1". */
  detailLabel: string;
  /** Human timestamp (from sent_at, else scheduled_at, else created_at). */
  timeLabel: string;
}

/** Per-status display styling (scheduled, sent, failed, acked, snoozed, deleted). */
const STATUS_STYLES: Record<string, DeliveryStatusStyle> = {
  scheduled: { color: "text-slate-600 bg-slate-100 border-slate-200", icon: "◷" },
  sent: { color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: "✓" },
  failed: { color: "text-red-700 bg-red-50 border-red-200", icon: "✕" },
  acked: { color: "text-sky-700 bg-sky-50 border-sky-200", icon: "☑" },
  snoozed: { color: "text-amber-700 bg-amber-50 border-amber-200", icon: "◔" },
  deleted: { color: "text-slate-500 bg-slate-100 border-slate-200", icon: "⊘" },
};

/** Human labels for each delivery status. */
const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  sent: "Sent",
  failed: "Failed",
  acked: "Acknowledged",
  snoozed: "Snoozed",
  deleted: "Deleted",
};

/**
 * Map a delivery status to its human label.
 *
 * Unknown statuses fall back to the raw status string (title-cased) so the UI
 * still renders something sensible if the backend adds a new status before the
 * frontend knows about it.
 */
export function deliveryStatusLabel(status: string): string {
  const known = STATUS_LABELS[status];
  if (known !== undefined) {
    return known;
  }
  if (status.length === 0) {
    return "Unknown";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Map a delivery status to its display styling.
 *
 * Unknown statuses fall back to a neutral gray badge.
 */
export function deliveryStatusStyle(status: string): DeliveryStatusStyle {
  return (
    STATUS_STYLES[status] ?? {
      color: "text-slate-600 bg-slate-100 border-slate-200",
      icon: "•",
    }
  );
}

/**
 * Format the occurrence + offset detail line for a delivery row.
 *
 * Returns `"1d before · occ-1"` when both an offset and occurrence id are
 * present, `"occ-1"` when only the occurrence is known, `"1d before"` when
 * only the offset is known, and `"—"` when neither is present.
 */
export function deliveryDetailLabel(log: DeliveryLog): string {
  const offset = log.offset ?? "";
  const occurrence = log.occurrence_id ?? "";
  const offsetPart = offset !== "" ? `${offset} before` : "";
  const occPart = occurrence !== "" ? occurrence : "";
  if (offsetPart !== "" && occPart !== "") {
    return `${offsetPart} · ${occPart}`;
  }
  if (offsetPart !== "") {
    return offsetPart;
  }
  if (occPart !== "") {
    return occPart;
  }
  return "—";
}

/**
 * Pick the best human timestamp for a delivery row.
 *
 * Prefers `sent_at`, then `scheduled_at`, then `created_at`, formatted as a
 * short local date + time (e.g. "Sep 1, 9:00 AM"). Returns "—" when no
 * timestamp is present or none can be parsed.
 */
export function deliveryTimeLabel(log: DeliveryLog): string {
  const raw = log.sent_at ?? log.scheduled_at ?? log.created_at;
  if (!raw) {
    return "—";
  }
  const date = parseIso(raw);
  if (!date) {
    return "—";
  }
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][date.getMonth()];
  const day = date.getDate();
  const period = date.getHours() >= 12 ? "PM" : "AM";
  let hours = date.getHours() % 12;
  if (hours === 0) {
    hours = 12;
  }
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hours}:${minutes} ${period}`;
}

/**
 * Derive renderable delivery-log rows from raw delivery-log data.
 *
 * Rows are sorted newest-first by their display timestamp (created_at as the
 * tiebreak), so the most recent delivery appears at the top of the drawer
 * section. The input order is not relied upon.
 */
export function deliveryLogRows(logs: readonly DeliveryLog[]): DeliveryLogRow[] {
  return [...logs]
    .sort((a, b) => {
      const at = a.created_at ?? "";
      const bt = b.created_at ?? "";
      return bt.localeCompare(at);
    })
    .map((log) => ({
      log,
      statusLabel: deliveryStatusLabel(log.status),
      statusStyle: deliveryStatusStyle(log.status),
      detailLabel: deliveryDetailLabel(log),
      timeLabel: deliveryTimeLabel(log),
    }));
}
