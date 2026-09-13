import { describe, it, expect } from "vitest";
import {
  validateDraft,
  safePriority,
  guardDraft,
} from "../../src/core/parseGuards";
import type { ParsedDraft } from "../../src/core/parseGuards";

describe("parseGuards core module", () => {
  describe("validateDraft", () => {
    it("accepts a valid draft and trims the title", () => {
      const result = validateDraft({ title: "  Dentist  " });
      expect(result).toEqual({ ok: true, draft: { title: "Dentist" } });
    });

    it("rejects a missing or blank title", () => {
      expect(validateDraft({ title: "" }).ok).toBe(false);
      expect(validateDraft({ title: "   " }).ok).toBe(false);
      expect(validateDraft({ title: undefined as unknown as string }).ok).toBe(
        false,
      );
    });

    it("rejects an invalid start_at", () => {
      const result = validateDraft({ title: "x", start_at: "not-a-date" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("start_at must be a valid date");
      }
    });

    it("rejects an empty start_at", () => {
      const result = validateDraft({ title: "x", start_at: "" });
      expect(result.ok).toBe(false);
    });

    it("accepts a date-like start_at", () => {
      const result = validateDraft({ title: "x", start_at: "2026-09-20T10:00:00" });
      expect(result.ok).toBe(true);
    });

    it("rejects an unknown priority", () => {
      const result = validateDraft({
        title: "x",
        priority: "high" as ParsedDraft["priority"],
      });
      expect(result.ok).toBe(false);
    });

    it("accepts a known priority", () => {
      const result = validateDraft({ title: "x", priority: "critical" });
      expect(result.ok).toBe(true);
    });

    it("rejects unknown channels", () => {
      const result = validateDraft({
        title: "x",
        channels: ["telegram", "sms"] as ParsedDraft["channels"],
      });
      expect(result.ok).toBe(false);
    });

    it("accepts known channels", () => {
      const result = validateDraft({ title: "x", channels: ["telegram", "email"] });
      expect(result.ok).toBe(true);
    });
  });

  describe("safePriority", () => {
    it("defaults to medium (uncertain) when nothing is known", () => {
      const result = safePriority({ title: "Team sync" });
      expect(result.priority).toBe("medium");
      expect(result.priorityUncertain).toBe(true);
    });

    it("tolerates a missing title when deciding priority", () => {
      const result = safePriority({ title: undefined as unknown as string });
      expect(result.priority).toBe("medium");
    });

    it("respects an explicit priority", () => {
      const result = safePriority({ title: "Team sync", priority: "low" });
      expect(result.priority).toBe("low");
      expect(result.priorityUncertain).toBe(false);
    });

    it("downgrades maybe/series/idea to low", () => {
      expect(safePriority({ title: "Maybe grab coffee" }).priority).toBe("low");
      expect(safePriority({ title: "Watch a series" }).priority).toBe("low");
      expect(safePriority({ title: "New idea to explore" }).priority).toBe("low");
    });

    it("promotes financial events to critical regardless of explicit priority", () => {
      const result = safePriority({
        title: "Pay rent",
        priority: "low",
      });
      expect(result.priority).toBe("critical");
      expect(result.priorityUncertain).toBe(false);
    });

    it("promotes financial events to critical even without an explicit priority", () => {
      expect(safePriority({ title: "Insurance renewal" }).priority).toBe(
        "critical",
      );
    });
  });

  describe("guardDraft", () => {
    it("returns null for an invalid draft", () => {
      expect(guardDraft({ title: "" })).toBeNull();
    });

    it("returns a guarded draft for a valid one", () => {
      const result = guardDraft({ title: "Pay rent" });
      expect(result).not.toBeNull();
      expect(result?.priority).toBe("critical");
    });
  });
});
