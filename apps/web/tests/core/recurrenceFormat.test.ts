import { describe, it, expect } from "vitest";
import { formatRecurrence } from "../../src/core/recurrenceFormat";

describe("recurrenceFormat core module", () => {
  it("labels a one-time event (no rrule)", () => {
    expect(formatRecurrence(null)).toEqual({
      frequency: "custom",
      label: "one-time",
      known: false,
    });
    expect(formatRecurrence(undefined)).toEqual({
      frequency: "custom",
      label: "one-time",
      known: false,
    });
    expect(formatRecurrence("")).toEqual({
      frequency: "custom",
      label: "one-time",
      known: false,
    });
  });

  it("labels daily recurrence", () => {
    expect(formatRecurrence("FREQ=DAILY")).toEqual({
      frequency: "daily",
      label: "daily",
      known: true,
    });
  });

  it("labels weekly recurrence with interval", () => {
    expect(formatRecurrence("FREQ=WEEKLY;INTERVAL=2")).toEqual({
      frequency: "weekly",
      label: "every 2 weeks",
      known: true,
    });
    expect(formatRecurrence("FREQ=WEEKLY;INTERVAL=1")).toEqual({
      frequency: "weekly",
      label: "every week",
      known: true,
    });
  });

  it("labels monthly recurrence", () => {
    expect(formatRecurrence("FREQ=MONTHLY")).toEqual({
      frequency: "monthly",
      label: "every month",
      known: true,
    });
    expect(formatRecurrence("FREQ=MONTHLY;INTERVAL=2")).toEqual({
      frequency: "monthly",
      label: "every 2 months",
      known: true,
    });
  });

  it("derives quarterly from a monthly interval of 3", () => {
    expect(formatRecurrence("FREQ=MONTHLY;INTERVAL=3")).toEqual({
      frequency: "quarterly",
      label: "every quarter",
      known: true,
    });
  });

  it("labels yearly recurrence", () => {
    expect(formatRecurrence("FREQ=YEARLY")).toEqual({
      frequency: "yearly",
      label: "every year",
      known: true,
    });
  });

  it("labels daily with interval", () => {
    expect(formatRecurrence("FREQ=DAILY;INTERVAL=3")).toEqual({
      frequency: "daily",
      label: "every 3 days",
      known: true,
    });
  });

  it("falls back to custom for unknown frequencies", () => {
    expect(formatRecurrence("FREQ=HOURLY")).toEqual({
      frequency: "custom",
      label: "custom",
      known: false,
    });
  });

  it("falls back to custom when FREQ is missing", () => {
    expect(formatRecurrence("INTERVAL=2")).toEqual({
      frequency: "custom",
      label: "custom",
      known: false,
    });
  });

  it("defaults interval to 1 and tolerates extra rule parts", () => {
    expect(formatRecurrence("FREQ=WEEKLY;BYDAY=MO;UNTIL=20270101T000000Z")).toEqual(
      {
        frequency: "weekly",
        label: "every week",
        known: true,
      },
    );
  });

  it("tolerates a malformed interval by defaulting to 1", () => {
    expect(formatRecurrence("FREQ=MONTHLY;INTERVAL=abc")).toEqual({
      frequency: "monthly",
      label: "every month",
      known: true,
    });
  });

  it("defaults a zero interval to 1", () => {
    expect(formatRecurrence("FREQ=WEEKLY;INTERVAL=0")).toEqual({
      frequency: "weekly",
      label: "every week",
      known: true,
    });
  });
});
