import { describe, it, expect } from "vitest";
import {
  isPastOccurrence,
  logAppliesToOccurrence,
  logsForOccurrence,
  notificationStatusForOccurrence,
  notificationStatusFromLogs,
  occurrenceLocalDate,
} from "../../src/core/notificationStatus";
import type { DeliveryLog } from "../../src/core/eventTypes";
import { toLocalDate } from "../../src/core/dateFmt";

function makeLog(overrides: Partial<DeliveryLog> = {}): DeliveryLog {
  return {
    id: 1,
    event_id: 7,
    occurrence_id: null,
    offset: "1d",
    status: "sent",
    scheduled_at: "2026-10-01T09:00:00",
    sent_at: "2026-10-01T09:00:00",
    error: null,
    created_at: "2026-10-01T09:00:00",
    updated_at: "2026-10-01T09:00:00",
    ...overrides,
  };
}

/** Fixed "now" for deterministic past/future assertions (UTC noon). */
const NOW = new Date("2026-10-12T12:00:00Z");

describe("notificationStatusFromLogs", () => {
  it("returns unsent when there are no rows", () => {
    expect(notificationStatusFromLogs([])).toBe("unsent");
  });

  it("returns unsent for scheduled-only rows", () => {
    expect(
      notificationStatusFromLogs([makeLog({ status: "scheduled" })]),
    ).toBe("unsent");
  });

  it("returns unsent for failed rows (nothing went out)", () => {
    expect(notificationStatusFromLogs([makeLog({ status: "failed" })])).toBe(
      "unsent",
    );
  });

  it("returns unsent for deleted rows", () => {
    expect(notificationStatusFromLogs([makeLog({ status: "deleted" })])).toBe(
      "unsent",
    );
  });

  it("returns unsent for unknown statuses", () => {
    expect(notificationStatusFromLogs([makeLog({ status: "queued" })])).toBe(
      "unsent",
    );
  });

  it("returns sent for sent rows", () => {
    expect(notificationStatusFromLogs([makeLog({ status: "sent" })])).toBe(
      "sent",
    );
  });

  it("returns sent for snoozed rows (the reminder went out)", () => {
    expect(notificationStatusFromLogs([makeLog({ status: "snoozed" })])).toBe(
      "sent",
    );
  });

  it("returns sent when scheduled rows accompany a sent row", () => {
    expect(
      notificationStatusFromLogs([
        makeLog({ status: "scheduled" }),
        makeLog({ status: "sent" }),
      ]),
    ).toBe("sent");
  });

  it("returns acked for acknowledged rows", () => {
    expect(notificationStatusFromLogs([makeLog({ status: "acked" })])).toBe(
      "acked",
    );
  });

  it("prefers acked over sent", () => {
    expect(
      notificationStatusFromLogs([
        makeLog({ status: "sent" }),
        makeLog({ status: "acked" }),
      ]),
    ).toBe("acked");
  });
});

describe("isPastOccurrence", () => {
  it("is past for a timed occurrence before now", () => {
    expect(
      isPastOccurrence("2026-10-12T11:59:59Z", false, NOW),
    ).toBe(true);
  });

  it("is not past for a timed occurrence after now", () => {
    expect(
      isPastOccurrence("2026-10-12T12:00:01Z", false, NOW),
    ).toBe(false);
  });

  it("is not past for an unparseable timed occurrence", () => {
    expect(isPastOccurrence("not-a-date", false, NOW)).toBe(false);
  });

  it("is past for an all-day occurrence on an earlier date", () => {
    expect(isPastOccurrence("2026-10-11", true, NOW)).toBe(true);
  });

  it("is not past for an all-day occurrence today", () => {
    // NOW is 2026-10-12T12:00Z; toLocalDate uses the browser zone. Compare
    // against the same local-day derivation the implementation uses.
    const todayLocal = toLocalDate(NOW);
    expect(isPastOccurrence(todayLocal, true, NOW)).toBe(false);
  });

  it("is not past for an all-day occurrence on a later date", () => {
    expect(isPastOccurrence("2026-10-13", true, NOW)).toBe(false);
  });

  it("is not past for a malformed all-day date", () => {
    expect(isPastOccurrence("2026-13-99", true, NOW)).toBe(false);
    expect(isPastOccurrence("", true, NOW)).toBe(false);
  });
});

describe("occurrenceLocalDate", () => {
  it("uses the date prefix verbatim for naive timestamps", () => {
    expect(occurrenceLocalDate("2026-10-12 14:00", "America/New_York")).toBe(
      "2026-10-12",
    );
    expect(occurrenceLocalDate("2026-10-12T14:00:00", "UTC")).toBe(
      "2026-10-12",
    );
  });

  it("returns null for a malformed naive date prefix", () => {
    expect(occurrenceLocalDate("2026-13-99 14:00", "UTC")).toBeNull();
  });

  it("converts aware timestamps into the event timezone", () => {
    // 2026-10-12T01:00Z is still Oct 11 in New York (EDT, UTC-4).
    expect(
      occurrenceLocalDate("2026-10-12T01:00:00Z", "America/New_York"),
    ).toBe("2026-10-11");
    expect(occurrenceLocalDate("2026-10-12T01:00:00Z", "UTC")).toBe(
      "2026-10-12",
    );
  });

  it("returns null for unparseable timestamps", () => {
    expect(occurrenceLocalDate("not-a-date", "UTC")).toBeNull();
  });
});

describe("logAppliesToOccurrence", () => {
  it("applies when the log has no occurrence id", () => {
    expect(
      logAppliesToOccurrence(makeLog({ occurrence_id: null }), "2026-10-12 14:00", "UTC"),
    ).toBe(true);
    expect(
      logAppliesToOccurrence(makeLog({ occurrence_id: "" }), "2026-10-12 14:00", "UTC"),
    ).toBe(true);
    expect(
      logAppliesToOccurrence(makeLog({ occurrence_id: "   " }), "2026-10-12 14:00", "UTC"),
    ).toBe(true);
  });

  it("matches date-form occurrence ids against the local date", () => {
    expect(
      logAppliesToOccurrence(
        makeLog({ occurrence_id: "2026-10-12" }),
        "2026-10-12",
        "UTC",
      ),
    ).toBe(true);
    expect(
      logAppliesToOccurrence(
        makeLog({ occurrence_id: "2026-10-13" }),
        "2026-10-12",
        "UTC",
      ),
    ).toBe(false);
  });

  it("matches instant-form occurrence ids within a minute", () => {
    // Backend keys timed occurrences as UTC ISO; the row is the same instant.
    expect(
      logAppliesToOccurrence(
        makeLog({ occurrence_id: "2026-10-12T14:00:00+00:00" }),
        "2026-10-12T14:00:30Z",
        "UTC",
      ),
    ).toBe(true);
    // A naive row stamp is interpreted in the event's timezone.
    expect(
      logAppliesToOccurrence(
        makeLog({ occurrence_id: "2026-10-12T18:00:00+00:00" }),
        "2026-10-12 14:00",
        "America/New_York",
      ),
    ).toBe(true);
    expect(
      logAppliesToOccurrence(
        makeLog({ occurrence_id: "2026-10-12T14:00:00+00:00" }),
        "2026-10-12T16:00:00Z",
        "UTC",
      ),
    ).toBe(false);
  });

  it("rejects unparseable occurrence ids and row stamps", () => {
    expect(
      logAppliesToOccurrence(
        makeLog({ occurrence_id: "not-a-date" }),
        "2026-10-12T14:00:00Z",
        "UTC",
      ),
    ).toBe(false);
    expect(
      logAppliesToOccurrence(
        makeLog({ occurrence_id: "2026-10-12T14:00:00Z" }),
        "not-a-date",
        "UTC",
      ),
    ).toBe(false);
  });
});

describe("logsForOccurrence", () => {
  it("keeps only the rows targeting the occurrence", () => {
    const logs = [
      makeLog({ id: 1, occurrence_id: "2026-10-12", status: "sent" }),
      makeLog({ id: 2, occurrence_id: "2026-10-13", status: "acked" }),
      makeLog({ id: 3, occurrence_id: null, status: "sent" }),
    ];
    const kept = logsForOccurrence(logs, "2026-10-12", "UTC");
    expect(kept.map((l) => l.id)).toEqual([1, 3]);
  });
});

describe("notificationStatusForOccurrence", () => {
  const logs = [makeLog({ occurrence_id: "2026-10-11", status: "acked" })];

  it("returns null for future occurrences (no highlight)", () => {
    expect(
      notificationStatusForOccurrence(logs, "2026-10-13T14:00:00Z", "UTC", false, NOW),
    ).toBeNull();
  });

  it("returns null for all-day occurrences happening today", () => {
    const todayLocal = toLocalDate(NOW);
    expect(
      notificationStatusForOccurrence([], todayLocal, "UTC", true, NOW),
    ).toBeNull();
  });

  it("derives acked for a past occurrence with an acknowledged delivery", () => {
    expect(
      notificationStatusForOccurrence(logs, "2026-10-11T14:00:00Z", "UTC", false, NOW),
    ).toBe("acked");
  });

  it("derives sent for a past occurrence with an unacknowledged delivery", () => {
    const sentLogs = [makeLog({ occurrence_id: "2026-10-11", status: "sent" })];
    expect(
      notificationStatusForOccurrence(sentLogs, "2026-10-11", "UTC", true, NOW),
    ).toBe("sent");
  });

  it("derives unsent for a past occurrence with no deliveries", () => {
    expect(
      notificationStatusForOccurrence([], "2026-10-11T14:00:00Z", "UTC", false, NOW),
    ).toBe("unsent");
  });

  it("ignores deliveries for other occurrences", () => {
    const other = [makeLog({ occurrence_id: "2026-10-10", status: "acked" })];
    expect(
      notificationStatusForOccurrence(other, "2026-10-11T14:00:00Z", "UTC", false, NOW),
    ).toBe("unsent");
  });
});
