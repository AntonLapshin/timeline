import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMemoryThemeStorage,
  createLocalStorageThemeStorage,
  defaultThemeApplier,
} from "../../src/adapters/themeStorage";
import { DEFAULT_THEME } from "../../src/core/theme";

/** A minimal in-memory localStorage (jsdom here lacks a real one). */
function installMockStorage(): Storage {
  const store = new Map<string, string>();
  const mock: Partial<Storage> = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    clear: vi.fn(() => store.clear()),
    removeItem: vi.fn((key: string) => store.delete(key)),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: mock,
  });
  return mock as Storage;
}

describe("themeStorage adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createMemoryThemeStorage", () => {
    it("returns the initial theme and tracks updates", () => {
      const storage = createMemoryThemeStorage("dark");
      expect(storage.get()).toBe("dark");
      storage.set("light");
      expect(storage.get()).toBe("light");
    });

    it("defaults to the core default theme", () => {
      const storage = createMemoryThemeStorage();
      expect(storage.get()).toBe(DEFAULT_THEME);
    });
  });

  describe("createLocalStorageThemeStorage", () => {
    beforeEach(() => {
      installMockStorage();
    });

    it("reads and writes the theme under the storage key", () => {
      const storage = createLocalStorageThemeStorage("test:theme");
      storage.set("dark");
      expect(window.localStorage.getItem("test:theme")).toBe("dark");
      expect(storage.get()).toBe("dark");
    });

    it("normalizes an invalid stored value to the default theme", () => {
      window.localStorage.setItem("test:theme", "sepia");
      const storage = createLocalStorageThemeStorage("test:theme");
      expect(storage.get()).toBe(DEFAULT_THEME);
    });

    it("falls back to the default when storage read throws", () => {
      vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const storage = createLocalStorageThemeStorage("test:theme");
      expect(storage.get()).toBe(DEFAULT_THEME);
    });

    it("does not throw when storage write is unavailable", () => {
      vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });
      const storage = createLocalStorageThemeStorage("test:theme");
      expect(() => storage.set("dark")).not.toThrow();
    });
  });

  describe("defaultThemeApplier", () => {
    it("adds the dark class for the dark theme", () => {
      defaultThemeApplier("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    it("removes the dark class for the light theme", () => {
      document.documentElement.classList.add("dark");
      defaultThemeApplier("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });
});
