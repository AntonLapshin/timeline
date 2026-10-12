import { useEffect, useRef, useState } from "react";
import { useServices } from "../services/useServices";
import {
  notificationStatusForOccurrence,
  type NotificationStatus,
} from "../../core/notificationStatus";
import type { DeliveryLog } from "../../core/eventTypes";

/**
 * Fetch reminder delivery logs for a set of event ids.
 *
 * Used to highlight past occurrences by notification state (green = sent and
 * acknowledged, amber = sent but not acknowledged, red = never sent). One
 * request per event id, de-duplicated while in flight; failed fetches leave
 * the id absent (no highlight) rather than mislabeling it "unsent".
 *
 * Pass a memoized id array — the fetch effect re-runs when it changes.
 */
export function useDeliveryLogs(
  eventIds: readonly number[],
): ReadonlyMap<number, DeliveryLog[]> {
  const { apiClient } = useServices();
  const inFlight = useRef(new Map<number, Promise<void>>());
  const [logsByEvent, setLogsByEvent] = useState<
    ReadonlyMap<number, DeliveryLog[]>
  >(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const missing = [...new Set(eventIds)].filter(
      (id) => !inFlight.current.has(id),
    );
    if (missing.length === 0) {
      return;
    }
    for (const id of missing) {
      const task = apiClient
        .getEventDeliveries(id)
        .then((logs) => {
          if (cancelled) {
            return;
          }
          setLogsByEvent((prev) => {
            if (prev.has(id)) {
              return prev;
            }
            const next = new Map(prev);
            next.set(id, logs);
            return next;
          });
        })
        .catch(() => {
          // Leave failed ids absent (no highlight) rather than mislabeling
          // them "unsent"; the `finally` below allows a later retry.
        })
        .finally(() => {
          inFlight.current.delete(id);
        });
      inFlight.current.set(id, task);
    }
    return () => {
      cancelled = true;
    };
  }, [apiClient, eventIds]);

  return logsByEvent;
}

/**
 * Resolve the event-card highlight for one occurrence from fetched logs.
 *
 * Returns null when the logs for the event have not arrived yet (or the
 * fetch failed), and when the occurrence is not past — the card keeps its
 * default treatment in both cases.
 */
export function selectNotificationStatus(
  logsByEvent: ReadonlyMap<number, DeliveryLog[]> | undefined,
  eventId: number,
  startIso: string,
  tz: string,
  allDay: boolean,
): NotificationStatus | null {
  const logs = logsByEvent?.get(eventId);
  if (!logs) {
    return null;
  }
  return notificationStatusForOccurrence(logs, startIso, tz, allDay);
}
