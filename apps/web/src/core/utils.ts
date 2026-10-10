/**
 * Shared pure helpers for the timeline web core.
 *
 * Small, dependency-free functions used across `src/core` and `src/ui` so the
 * logic lives in one place and is unit-tested once. No React, no browser APIs
 * — only data transformation.
 */

import type { EventChannel } from "./eventTypes";
import { EVENT_CHANNELS } from "./eventTypes";

/** Pad a number to two digits (e.g. 9 → "09"). */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parse a `"HH:MM"` wall-clock string into `[hour, minute]`.
 *
 * A missing minute (`"9"`) yields `[9, 0]`.
 */
export function parseHHMM(value: string): [number, number] {
  const [hourS, minuteS] = value.split(":");
  return [Number(hourS), Number(minuteS ?? "0")];
}

/**
 * Toggle a value in an array (used for channels and offsets).
 *
 * Returns a new array: removes `value` when present, appends it otherwise.
 */
export function toggleValue<T extends string>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/** Human labels for each reminder channel. */
export const CHANNEL_LABELS: Record<EventChannel, string> = {
  telegram: "Telegram",
};

/**
 * Human label for a reminder channel, falling back to the raw value for
 * forward-compatibility with channels the UI doesn't know yet.
 */
export function channelLabel(channel: string): string {
  return (CHANNEL_LABELS as Record<string, string>)[channel] ?? channel;
}

/** Whether a value is a known reminder channel. */
export function isKnownChannel(value: string): value is EventChannel {
  return (EVENT_CHANNELS as readonly string[]).includes(value);
}
