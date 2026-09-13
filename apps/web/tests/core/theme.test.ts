import { describe, it, expect } from "vitest";
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  isTheme,
  normalizeTheme,
  nextTheme,
  themeLabel,
} from "../../src/core/theme";

describe("theme core module", () => {
  it("exposes the two supported themes in display order", () => {
    expect(THEMES).toEqual(["light", "dark"]);
  });

  it("defaults to light", () => {
    expect(DEFAULT_THEME).toBe("light");
  });

  it("uses a namespaced storage key", () => {
    expect(THEME_STORAGE_KEY).toBe("timeline:theme");
  });

  describe("isTheme", () => {
    it("accepts light and dark", () => {
      expect(isTheme("light")).toBe(true);
      expect(isTheme("dark")).toBe(true);
    });
    it("rejects other values", () => {
      expect(isTheme("sepia")).toBe(false);
      expect(isTheme("")).toBe(false);
      expect(isTheme(null)).toBe(false);
      expect(isTheme(undefined)).toBe(false);
      expect(isTheme(42)).toBe(false);
    });
  });

  describe("normalizeTheme", () => {
    it("passes through a valid theme", () => {
      expect(normalizeTheme("light")).toBe("light");
      expect(normalizeTheme("dark")).toBe("dark");
    });
    it("falls back to the default for an invalid value", () => {
      expect(normalizeTheme("sepia")).toBe(DEFAULT_THEME);
      expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
      expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    });
  });

  describe("nextTheme", () => {
    it("toggles light -> dark", () => {
      expect(nextTheme("light")).toBe("dark");
    });
    it("toggles dark -> light", () => {
      expect(nextTheme("dark")).toBe("light");
    });
  });

  describe("themeLabel", () => {
    it("returns a human label for each theme", () => {
      expect(themeLabel("light")).toBe("Light");
      expect(themeLabel("dark")).toBe("Dark");
    });
  });
});
