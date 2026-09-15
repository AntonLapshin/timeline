/**
 * Sample data for the component Showcase gallery (issue #56).
 *
 * Pure presentational data — no business logic. The Showcase page uses these
 * fixtures to render every UI component in its key states (empty, populated,
 * error, dark/light, narrow/mobile) with the real components but injected
 * fake services, so the gallery needs no backend.
 */

import type {
  EventOccurrence,
  EventRead,
  SummaryResponse,
} from "../../core/eventTypes";

/** A populated, varied set of events for the Timeline / drawer galleries. */
export const SHOWCASE_EVENTS: EventRead[] = [
  {
    id: 1,
    title: "HRA quarterly check-up",
    description: "Annual-ish health review with Dr. Chen.",
    location_url: "",
    tags: ["health"],
    type: "recurrent",
    start_at: "2026-09-05T10:00:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: "FREQ=MONTHLY;INTERVAL=3",
    priority: "critical",
    channels: ["telegram", "email"],
    reminder_offsets: ["1d", "2h"],
    remind_time_of_day: "09:00",
    repeat_until_ack: true,
    snooze_allowed: true,
    email_enabled: true,
    email_to: "me@example.com",
    source: "web",
    raw_input: null,
    ai_confidence: null,
    status: "active",
    created_at: "2026-08-01T00:00:00",
    updated_at: "2026-08-01T00:00:00",
  },
  {
    id: 2,
    title: "Product design review",
    description: "Review the new onboarding flow with the team.",
    location_url: "",
    tags: ["work"],
    type: "one_time",
    start_at: "2026-09-12T14:30:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: null,
    priority: "medium",
    channels: ["telegram"],
    reminder_offsets: ["7d", "1d"],
    remind_time_of_day: null,
    repeat_until_ack: false,
    snooze_allowed: false,
    email_enabled: false,
    email_to: null,
    source: "web",
    raw_input: null,
    ai_confidence: null,
    status: "active",
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
  },
  {
    id: 3,
    title: "Water the plants",
    description: "",
    location_url: "",
    tags: ["home"],
    type: "recurrent",
    start_at: "2026-09-15T08:00:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: "FREQ=WEEKLY",
    priority: "low",
    channels: ["telegram"],
    reminder_offsets: ["2h"],
    remind_time_of_day: null,
    repeat_until_ack: false,
    snooze_allowed: true,
    email_enabled: false,
    email_to: null,
    source: "ai",
    raw_input: "water plants every monday",
    ai_confidence: 0.94,
    status: "active",
    created_at: "2026-09-02T00:00:00",
    updated_at: "2026-09-02T00:00:00",
  },
];

/** A populated set of occurrences for the Calendar / drawer galleries. */
export const SHOWCASE_OCCURRENCES: EventOccurrence[] = [
  {
    event_id: 1,
    title: "HRA quarterly check-up",
    priority: "critical",
    tag: "health",
    rrule: "FREQ=MONTHLY;INTERVAL=3",
    start_at: "2026-09-05T10:00:00",
    all_day: false,
    tz: "UTC",
    next_occurrence: "2026-12-05T10:00:00",
  },
  {
    event_id: 2,
    title: "Product design review",
    priority: "medium",
    tag: "work",
    rrule: null,
    start_at: "2026-09-12T14:30:00",
    all_day: false,
    tz: "UTC",
    next_occurrence: null,
  },
  {
    event_id: 3,
    title: "Water the plants",
    priority: "low",
    tag: "home",
    rrule: "FREQ=WEEKLY",
    start_at: "2026-09-15T08:00:00",
    all_day: false,
    tz: "UTC",
    next_occurrence: "2026-09-22T08:00:00",
  },
];

/** A populated summary payload for the SummaryBar gallery. */
export const SHOWCASE_SUMMARY: SummaryResponse = {
  month: "2026-09",
  total: 3,
  by_priority: { critical: 1, medium: 1, low: 1 },
};
