import { describe, it, expect, vi, afterEach } from "vitest";
import {
  emptyDraft,
  draftFromEvent,
  validateDraft,
  stepErrors,
  canGoNext,
  nextStep,
  prevStep,
  rruleForChoice,
  recurrenceChoiceFromRrule,
  draftStartAt,
  buildCreatePayload,
  buildUpdatePayload,
  localTimezone,
  RECURRENCE_CHOICES,
  REMINDER_OFFSET_PRESETS,
  DEFAULT_TZ,
  type EventDraft,
} from "../../src/core/eventWizard";
import type { EventRead } from "../../src/core/eventTypes";

/** A minimal complete, valid draft for payload tests. */
function validDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: "Dentist",
    notes: "Annual checkup",
    allDay: false,
    date: "2026-09-20",
    time: "10:30",
    tz: "Europe/Berlin",
    recurrence: "none",
    customRrule: "",
    priority: "medium",
    channels: ["telegram"],
    reminderOffsets: ["1d"],
    ...overrides,
  };
}

function sampleEvent(overrides: Partial<EventRead> = {}): EventRead {
  return {
    id: 3,
    title: "HRA",
    description: "Annual review",
    location_url: "",
    tags: ["health"],
    type: "recurrent",
    start_at: "2026-09-05T10:00:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: "FREQ=MONTHLY;INTERVAL=3",
    priority: "critical",
    channels: ["telegram"],
    reminder_offsets: ["7d", "1d"],
    remind_time_of_day: null,
    repeat_until_ack: false,
    snooze_allowed: true,
    email_enabled: false,
    email_to: null,
    source: "web",
    raw_input: null,
    ai_confidence: null,
    status: "active",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

describe("eventWizard core module", () => {
  describe("emptyDraft", () => {
    it("defaults date/time/tz to the provided now", () => {
      const draft = emptyDraft(new Date(2026, 8, 20, 10, 30));
      expect(draft.date).toBe("2026-09-20");
      expect(draft.time).toBe("10:30");
      expect(draft.title).toBe("");
      expect(draft.recurrence).toBe("none");
      expect(draft.priority).toBe("medium");
      expect(draft.channels).toEqual(["telegram"]);
      expect(draft.reminderOffsets).toEqual([]);
      expect(draft.allDay).toBe(false);
    });

    it("defaults to the current date when no argument is given", () => {
      const draft = emptyDraft();
      expect(draft.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(draft.time).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  describe("localTimezone", () => {
    it("returns a non-empty timezone label", () => {
      expect(localTimezone(new Date())).toBeTruthy();
    });

    it("falls back to DEFAULT_TZ when UTC and no zone name is available", () => {
      vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
      vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue(
        { timeZone: "" } as Intl.ResolvedDateTimeFormatOptions,
      );
      expect(localTimezone(new Date(2026, 0, 1))).toBe("UTC");
    });

    it("builds an offset-based label when no zone name is available", () => {
      vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(180);
      vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue(
        { timeZone: "" } as Intl.ResolvedDateTimeFormatOptions,
      );
      expect(localTimezone(new Date(2026, 0, 1))).toBe("UTC-03:00");
    });

    it("builds a positive offset label when the zone is ahead of UTC", () => {
      vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-120);
      vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue(
        { timeZone: "" } as Intl.ResolvedDateTimeFormatOptions,
      );
      expect(localTimezone(new Date(2026, 0, 1))).toBe("UTC+02:00");
    });

    it("falls back when resolvedOptions throws", () => {
      vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
      vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
        () => {
          throw new Error("boom");
        },
      );
      expect(localTimezone(new Date(2026, 0, 1))).toBe("UTC");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("recurrenceChoiceFromRrule", () => {
    it("maps null/empty to none", () => {
      expect(recurrenceChoiceFromRrule(null)).toBe("none");
      expect(recurrenceChoiceFromRrule(undefined)).toBe("none");
      expect(recurrenceChoiceFromRrule("")).toBe("none");
    });
    it("maps each frequency", () => {
      expect(recurrenceChoiceFromRrule("FREQ=DAILY")).toBe("daily");
      expect(recurrenceChoiceFromRrule("FREQ=WEEKLY")).toBe("weekly");
      expect(recurrenceChoiceFromRrule("FREQ=MONTHLY")).toBe("monthly");
      expect(recurrenceChoiceFromRrule("FREQ=MONTHLY;INTERVAL=3")).toBe("quarterly");
      expect(recurrenceChoiceFromRrule("FREQ=YEARLY")).toBe("yearly");
    });
    it("maps an unrecognized rule to custom", () => {
      expect(recurrenceChoiceFromRrule("FREQ=HOURLY")).toBe("custom");
      expect(recurrenceChoiceFromRrule("garbage")).toBe("custom");
    });
  });

  describe("draftFromEvent", () => {
    it("pre-fills a draft from an existing event", () => {
      const draft = draftFromEvent(sampleEvent());
      expect(draft.title).toBe("HRA");
      expect(draft.notes).toBe("Annual review");
      expect(draft.date).toBe("2026-09-05");
      expect(draft.time).toBe("10:00");
      expect(draft.tz).toBe("UTC");
      expect(draft.recurrence).toBe("quarterly");
      expect(draft.priority).toBe("critical");
      expect(draft.channels).toEqual(["telegram"]);
      expect(draft.reminderOffsets).toEqual(["7d", "1d"]);
    });

    it("blanks the time for an all-day event", () => {
      const draft = draftFromEvent(sampleEvent({ all_day: true }));
      expect(draft.allDay).toBe(true);
      expect(draft.time).toBe("");
    });

    it("keeps an unrecognized rrule as the custom rule", () => {
      const draft = draftFromEvent(
        sampleEvent({ rrule: "FREQ=HOURLY;INTERVAL=2" }),
      );
      expect(draft.recurrence).toBe("custom");
      expect(draft.customRrule).toBe("FREQ=HOURLY;INTERVAL=2");
    });

    it("defaults channels to telegram when the event has none", () => {
      const draft = draftFromEvent(sampleEvent({ channels: [] }));
      expect(draft.channels).toEqual(["telegram"]);
    });

    it("handles an unparseable start timestamp by blanking date and time", () => {
      const draft = draftFromEvent(sampleEvent({ start_at: "not-a-date" }));
      expect(draft.date).toBe("");
      expect(draft.time).toBe("");
    });

    it("keeps time blank for an all-day event even with an unparseable start", () => {
      const draft = draftFromEvent(
        sampleEvent({ all_day: true, start_at: "not-a-date" }),
      );
      expect(draft.allDay).toBe(true);
      expect(draft.time).toBe("");
    });

    it("uses an empty custom rule for a null rrule", () => {
      const draft = draftFromEvent(sampleEvent({ rrule: null }));
      expect(draft.recurrence).toBe("none");
      expect(draft.customRrule).toBe("");
    });

    it("falls back to DEFAULT_TZ when the event has no timezone", () => {
      const draft = draftFromEvent(sampleEvent({ tz: "" }));
      expect(draft.tz).toBe("UTC");
    });
  });

  describe("validateDraft", () => {
    it("accepts a complete draft", () => {
      expect(validateDraft(validDraft())).toEqual({});
    });
    it("rejects a missing title", () => {
      const errors = validateDraft(validDraft({ title: "   " }));
      expect(errors.title).toBe("Title is required");
    });
    it("rejects a missing date", () => {
      const errors = validateDraft(validDraft({ date: "" }));
      expect(errors.date).toBe("Date is required");
    });
    it("rejects a missing time for a timed event", () => {
      const errors = validateDraft(validDraft({ time: "" }));
      expect(errors.time).toBe("Time is required");
    });
    it("does not require a time for an all-day event", () => {
      const errors = validateDraft(validDraft({ allDay: true, time: "" }));
      expect(errors.time).toBeUndefined();
    });
    it("rejects a missing custom rrule when recurrence is custom", () => {
      const errors = validateDraft(
        validDraft({ recurrence: "custom", customRrule: "  " }),
      );
      expect(errors.customRrule).toBe("Recurrence rule is required");
    });
  });

  describe("stepErrors / canGoNext", () => {
    it("reports only step-1 errors for step 1", () => {
      const errors = stepErrors(1, validDraft({ title: "", time: "" }));
      expect(errors.title).toBe("Title is required");
      expect(errors.time).toBe("Time is required");
      expect(errors.customRrule).toBeUndefined();
    });
    it("reports only the custom-rrule error for step 2", () => {
      const errors = stepErrors(
        2,
        validDraft({ recurrence: "custom", customRrule: "" }),
      );
      expect(errors.customRrule).toBe("Recurrence rule is required");
      expect(errors.title).toBeUndefined();
    });
    it("reports no errors for step 3", () => {
      expect(stepErrors(3, validDraft({ title: "" }))).toEqual({});
    });
    it("canGoNext is true only when the step's fields are complete", () => {
      expect(canGoNext(1, validDraft())).toBe(true);
      expect(canGoNext(1, validDraft({ title: "" }))).toBe(false);
      expect(canGoNext(2, validDraft())).toBe(true);
      expect(
        canGoNext(2, validDraft({ recurrence: "custom", customRrule: "" })),
      ).toBe(false);
      expect(canGoNext(3, validDraft())).toBe(true);
    });
  });

  describe("nextStep / prevStep", () => {
    it("advances forward and clamps at 3", () => {
      expect(nextStep(1)).toBe(2);
      expect(nextStep(2)).toBe(3);
      expect(nextStep(3)).toBe(3);
    });
    it("moves backward and clamps at 1", () => {
      expect(prevStep(3)).toBe(2);
      expect(prevStep(2)).toBe(1);
      expect(prevStep(1)).toBe(1);
    });
  });

  describe("rruleForChoice", () => {
    it("returns null for none", () => {
      expect(rruleForChoice("none", "")).toBeNull();
    });
    it("builds the canonical rule for each preset", () => {
      expect(rruleForChoice("daily", "")).toBe("FREQ=DAILY");
      expect(rruleForChoice("weekly", "")).toBe("FREQ=WEEKLY");
      expect(rruleForChoice("monthly", "")).toBe("FREQ=MONTHLY");
      expect(rruleForChoice("quarterly", "")).toBe("FREQ=MONTHLY;INTERVAL=3");
      expect(rruleForChoice("yearly", "")).toBe("FREQ=YEARLY");
    });
    it("uses the custom rule, trimmed, or null when blank", () => {
      expect(rruleForChoice("custom", "  FREQ=WEEKLY;BYDAY=MO  ")).toBe(
        "FREQ=WEEKLY;BYDAY=MO",
      );
      expect(rruleForChoice("custom", "  ")).toBeNull();
    });
  });

  describe("draftStartAt", () => {
    it("combines date and time for a timed event", () => {
      expect(draftStartAt(validDraft())).toBe("2026-09-20T10:30:00");
    });
    it("uses midnight for an all-day event", () => {
      expect(draftStartAt(validDraft({ allDay: true, time: "" }))).toBe(
        "2026-09-20T00:00:00",
      );
    });
    it("falls back to midnight when the time is missing", () => {
      expect(draftStartAt(validDraft({ time: "" }))).toBe("2026-09-20T00:00:00");
    });
  });

  describe("buildCreatePayload", () => {
    it("builds a one_time payload when recurrence is none", () => {
      const payload = buildCreatePayload(validDraft());
      expect(payload.title).toBe("Dentist");
      expect(payload.type).toBe("one_time");
      expect(payload.rrule).toBeNull();
      expect(payload.start_at).toBe("2026-09-20T10:30:00");
      expect(payload.priority).toBe("medium");
      expect(payload.channels).toEqual(["telegram"]);
      expect(payload.reminder_offsets).toEqual(["1d"]);
      expect(payload.source).toBe("web");
      expect(payload.status).toBe("active");
    });
    it("builds a recurrent payload with the derived rrule", () => {
      const payload = buildCreatePayload(
        validDraft({ recurrence: "quarterly" }),
      );
      expect(payload.type).toBe("recurrent");
      expect(payload.rrule).toBe("FREQ=MONTHLY;INTERVAL=3");
    });
    it("trims the title", () => {
      const payload = buildCreatePayload(validDraft({ title: "  Dentist  " }));
      expect(payload.title).toBe("Dentist");
    });
  });

  describe("buildUpdatePayload", () => {
    it("builds a partial update reflecting the draft", () => {
      const payload = buildUpdatePayload(validDraft({ recurrence: "weekly" }));
      expect(payload.title).toBe("Dentist");
      expect(payload.type).toBe("recurrent");
      expect(payload.rrule).toBe("FREQ=WEEKLY");
      expect(payload.start_at).toBe("2026-09-20T10:30:00");
      expect(payload.priority).toBe("medium");
    });
    it("explicitly clears rrule when the user chose none", () => {
      const payload = buildUpdatePayload(validDraft());
      expect(payload.rrule).toBeNull();
      expect(payload.type).toBe("one_time");
    });
  });

  describe("exported constants", () => {
    it("exposes the recurrence choices and reminder presets", () => {
      expect(RECURRENCE_CHOICES).toContain("custom");
      expect(REMINDER_OFFSET_PRESETS).toEqual(["7d", "1d", "2h", "1h", "30m", "15m"]);
      expect(DEFAULT_TZ).toBe("UTC");
    });
  });
});
