import { describe, it, expect } from "vitest";
import {
  pad2,
  parseHHMM,
  toggleValue,
  channelLabel,
  isKnownChannel,
} from "../../src/core/utils";

describe("core utils", () => {
  it("pads numbers to two digits", () => {
    expect(pad2(9)).toBe("09");
    expect(pad2(12)).toBe("12");
  });

  it("parses HH:MM wall-clock strings", () => {
    expect(parseHHMM("22:00")).toEqual([22, 0]);
    expect(parseHHMM("08:30")).toEqual([8, 30]);
    expect(parseHHMM("9")).toEqual([9, 0]);
  });

  it("toggles values in an array immutably", () => {
    expect(toggleValue(["telegram"], "telegram")).toEqual([]);
    expect(toggleValue([], "telegram")).toEqual(["telegram"]);
    const list = ["7d"];
    expect(toggleValue(list, "1d")).toEqual(["7d", "1d"]);
    expect(list).toEqual(["7d"]);
  });

  it("labels known channels and passes through unknown ones", () => {
    expect(channelLabel("telegram")).toBe("Telegram");
    expect(channelLabel("sms")).toBe("sms");
  });

  it("detects known channels", () => {
    expect(isKnownChannel("telegram")).toBe(true);
    expect(isKnownChannel("sms")).toBe(false);
  });
});
