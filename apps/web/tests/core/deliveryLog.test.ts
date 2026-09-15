import { describe, it, expect } from "vitest";
import {
  deliveryStatusLabel,
  deliveryStatusStyle,
  deliveryDetailLabel,
  deliveryTimeLabel,
  deliveryLogRows,
} from "../../src/core/deliveryLog";
import type { DeliveryLog } from "../../src/core/eventTypes";

function makeLog(overrides: Partial<DeliveryLog> = {}): DeliveryLog {
  return {
    id: 1,
    event_id: 1,
    occurrence_id: "occ-1",
    offset: "1d",
    status: "sent",
    scheduled_at: "2026-09-01T09:00:00",
    sent_at: "2026-09-01T09:00:00",
    error: null,
    created_at: "2026-09-01T09:00:00",
    updated_at: "2026-09-01T09:00:00",
    ...overrides,
  };
}

describe("deliveryStatusLabel", () => {
  it("maps known statuses to human labels", () => {
    expect(deliveryStatusLabel("scheduled")).toBe("Scheduled");
    expect(deliveryStatusLabel("sent")).toBe("Sent");
    expect(deliveryStatusLabel("failed")).toBe("Failed");
    expect(deliveryStatusLabel("acked")).toBe("Acknowledged");
    expect(deliveryStatusLabel("snoozed")).toBe("Snoozed");
    expect(deliveryStatusLabel("deleted")).toBe("Deleted");
  });

  it("title-cases an unknown status", () => {
    expect(deliveryStatusLabel("queued")).toBe("Queued");
  });

  it("returns Unknown for an empty status", () => {
    expect(deliveryStatusLabel("")).toBe("Unknown");
  });
});

describe("deliveryStatusStyle", () => {
  it("returns a style for each known status", () => {
    for (const status of [
      "scheduled",
      "sent",
      "failed",
      "acked",
      "snoozed",
      "deleted",
    ]) {
      const style = deliveryStatusStyle(status);
      expect(style.color.length).toBeGreaterThan(0);
      expect(style.icon.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a neutral style for unknown statuses", () => {
    const style = deliveryStatusStyle("mystery");
    expect(style.color).toContain("slate");
    expect(style.icon).toBe("•");
  });
});

describe("deliveryDetailLabel", () => {
  it("combines offset and occurrence when both are present", () => {
    expect(deliveryDetailLabel(makeLog())).toBe("1d before · occ-1");
  });

  it("returns only the offset when no occurrence is present", () => {
    expect(deliveryDetailLabel(makeLog({ occurrence_id: null }))).toBe("1d before");
  });

  it("returns only the occurrence when no offset is present", () => {
    expect(deliveryDetailLabel(makeLog({ offset: null }))).toBe("occ-1");
  });

  it("returns an em dash when neither is present", () => {
    expect(
      deliveryDetailLabel(makeLog({ offset: null, occurrence_id: null })),
    ).toBe("—");
  });

  it("treats empty strings as absent", () => {
    expect(deliveryDetailLabel(makeLog({ offset: "", occurrence_id: "" }))).toBe("—");
  });
});

describe("deliveryTimeLabel", () => {
  it("prefers sent_at over scheduled_at and created_at", () => {
    const log = makeLog({
      sent_at: "2026-09-05T14:30:00",
      scheduled_at: "2026-09-05T09:00:00",
      created_at: "2026-09-05T08:00:00",
    });
    expect(deliveryTimeLabel(log)).toBe("Sep 5, 2:30 PM");
  });

  it("falls back to scheduled_at when sent_at is absent", () => {
    const log = makeLog({ sent_at: null, scheduled_at: "2026-09-05T09:05:00" });
    expect(deliveryTimeLabel(log)).toBe("Sep 5, 9:05 AM");
  });

  it("falls back to created_at when sent/scheduled are absent", () => {
    const log = makeLog({ sent_at: null, scheduled_at: null });
    expect(deliveryTimeLabel(log)).toBe("Sep 1, 9:00 AM");
  });

  it("returns an em dash when no timestamp is present", () => {
    const log = makeLog({
      sent_at: null,
      scheduled_at: null,
      created_at: "",
    });
    expect(deliveryTimeLabel(log)).toBe("—");
  });

  it("returns an em dash when the timestamp cannot be parsed", () => {
    const log = makeLog({ sent_at: "not-a-date" });
    expect(deliveryTimeLabel(log)).toBe("—");
  });

  it("formats midnight as 12 AM", () => {
    const log = makeLog({ sent_at: "2026-09-05T00:00:00" });
    expect(deliveryTimeLabel(log)).toBe("Sep 5, 12:00 AM");
  });
});

describe("deliveryLogRows", () => {
  const older = makeLog({
    id: 1,
    created_at: "2026-09-01T09:00:00",
    status: "sent",
  });
  const newer = makeLog({
    id: 2,
    created_at: "2026-09-05T09:00:00",
    status: "acked",
  });

  it("sorts rows newest-first regardless of input order", () => {
    const rows = deliveryLogRows([older, newer]);
    expect(rows.map((r) => r.log.id)).toEqual([2, 1]);
  });

  it("derives status label, style, detail and time for each row", () => {
    const rows = deliveryLogRows([older]);
    const row = rows[0];
    expect(row.statusLabel).toBe("Sent");
    expect(row.statusStyle.icon).toBe("✓");
    expect(row.detailLabel).toBe("1d before · occ-1");
    expect(row.timeLabel).toBe("Sep 1, 9:00 AM");
  });

  it("returns an empty array for no logs", () => {
    expect(deliveryLogRows([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [older, newer];
    deliveryLogRows(input);
    expect(input.map((l) => l.id)).toEqual([1, 2]);
  });

  it("handles logs with a missing created_at in sorting", () => {
    const noTimestampA = makeLog({
      id: 3,
      created_at: null as unknown as string,
    });
    const noTimestampB = makeLog({
      id: 4,
      created_at: null as unknown as string,
    });
    const rows = deliveryLogRows([noTimestampA, noTimestampB]);
    // Missing created_at falls back to "" so both rows are comparable.
    expect(rows.map((r) => r.log.id).sort()).toEqual([3, 4]);
  });
});
