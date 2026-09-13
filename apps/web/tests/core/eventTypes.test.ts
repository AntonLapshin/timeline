import { describe, it, expect } from "vitest";
import { EVENT_PRIORITIES, EVENT_CHANNELS } from "../../src/core/eventTypes";

describe("eventTypes core module", () => {
  it("exposes priorities in canonical order", () => {
    expect(EVENT_PRIORITIES).toEqual(["critical", "medium", "low"]);
  });

  it("exposes channels", () => {
    expect(EVENT_CHANNELS).toEqual(["telegram", "email"]);
  });
});
