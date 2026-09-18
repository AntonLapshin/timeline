import { describe, it, expect } from "vitest";
import { isShowcaseLocation } from "../../src/core/showcaseRoute";

describe("isShowcaseLocation", () => {
  it("matches the canonical query flag", () => {
    expect(isShowcaseLocation("?showcase", "", "/")).toBe(true);
    expect(isShowcaseLocation("?showcase=1", "", "/")).toBe(true);
    expect(isShowcaseLocation("?foo=1&showcase=1", "", "/")).toBe(true);
  });

  it("matches the hash form", () => {
    expect(isShowcaseLocation("", "#showcase", "/")).toBe(true);
    expect(isShowcaseLocation("", "#/SHOWCASE", "/")).toBe(true);
  });

  it("matches a /showcase path segment", () => {
    expect(isShowcaseLocation("", "", "/showcase")).toBe(true);
    expect(isShowcaseLocation("", "", "/timeline/showcase")).toBe(true);
    expect(isShowcaseLocation("", "", "/timeline/showcase/")).toBe(true);
  });

  it("rejects the normal app location", () => {
    expect(isShowcaseLocation("", "", "/")).toBe(false);
    expect(isShowcaseLocation("?foo=1", "", "/")).toBe(false);
    expect(isShowcaseLocation("", "#/timeline", "/")).toBe(false);
    expect(isShowcaseLocation("", "", "/timeline")).toBe(false);
    // A substring that is not a full path segment must not match.
    expect(isShowcaseLocation("", "", "/myshowcase")).toBe(false);
  });
});
