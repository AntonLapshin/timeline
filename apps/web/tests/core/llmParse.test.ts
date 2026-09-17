import { describe, it, expect, vi } from "vitest";
import {
  createLlmParser,
  draftFromParsed,
  parsedToWizardDraft,
  type ParseResult,
} from "../../src/core/llmParse";
import type { FetchLike } from "../../src/core/apiClient";
import type { ParsedDraft } from "../../src/core/parseGuards";

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function mockFetch(
  handler: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => MockResponse,
): FetchLike {
  return vi.fn(
    async (url: string, init?: { method?: string; body?: string }) =>
      handler(url, init),
  ) as unknown as FetchLike;
}

describe("llmParse core module", () => {
  it("parses text via POST /api/events/parse and returns a draft", async () => {
    const draft = { title: "Pay rent", priority: "critical" };
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:8123/api/events/parse");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ text: "Pay rent on the 1st" }));
      return { ok: true, status: 200, json: async () => draft };
    });
    const parser = createLlmParser("http://127.0.0.1:8123", fetchImpl);
    const result = (await parser.parse("Pay rent on the 1st")) as Extract<
      ParseResult,
      { ok: true }
    >;
    expect(result.ok).toBe(true);
    expect(result.draft).toEqual(draft);
  });

  it("returns a distinct cannot-reach-API result when fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as FetchLike;
    const parser = createLlmParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Not the 503 "unavailable" path — the API was simply unreachable.
      expect(result.unavailable).toBeUndefined();
      expect(result.error).toContain("Cannot reach the API");
    }
  });

  it("maps HTTP 502 to an actionable LLM-failure result (no throw)", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 502,
      json: async () => ({ detail: "LLM request failed (HTTP 401)" }),
    }));
    const parser = createLlmParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Not the 503 "unavailable" path — the LLM call itself failed.
      expect(result.unavailable).toBeUndefined();
      expect(result.error).toContain(
        "LLM parsing failed — check LLM_API_KEY / LLM_MODEL in .env and the API logs",
      );
      // The server detail is appended so the owner sees the underlying cause.
      expect(result.error).toContain("(server: LLM request failed (HTTP 401))");
    }
  });

  it("returns the plain LLM-failure message when the 502 body has no detail", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));
    const parser = createLlmParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("hello");
    expect(result).toEqual({
      ok: false,
      error:
        "LLM parsing failed — check LLM_API_KEY / LLM_MODEL in .env and the API logs",
    });
  });

  it("returns the plain LLM-failure message when the 502 body is not JSON", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error("not json")),
    }));
    const parser = createLlmParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("hello");
    expect(result).toEqual({
      ok: false,
      error:
        "LLM parsing failed — check LLM_API_KEY / LLM_MODEL in .env and the API logs",
    });
  });

  it("maps any other HTTP error status to a typed result instead of throwing", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const parser = createLlmParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("hello");
    expect(result).toEqual({
      ok: false,
      error:
        "Unexpected API error (HTTP 500). You can still add the event manually.",
    });
  });

  it("returns a graceful unavailable result on HTTP 503 (LLM key absent)", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    const parser = createLlmParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("dentist tuesday");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unavailable).toBe(true);
      expect(result.error).toContain("unavailable");
    }
  });
});

describe("draftFromParsed", () => {
  it("maps a one-time timed draft to a wizard draft", () => {
    const draft = draftFromParsed(
      { title: "Dentist", start_at: "2026-09-22T15:00:00", tz: "UTC" },
      "medium",
    );
    expect(draft.title).toBe("Dentist");
    expect(draft.date).toBe("2026-09-22");
    expect(draft.time).toBe("15:00");
    expect(draft.recurrence).toBe("none");
    expect(draft.priority).toBe("medium");
    expect(draft.channels).toEqual(["telegram"]);
    expect(draft.reminderOffsets).toEqual([]);
  });

  it("maps an all-day draft with no time", () => {
    const draft = draftFromParsed(
      { title: "Holiday", start_at: "2026-12-25T00:00:00", all_day: true },
      "low",
    );
    expect(draft.allDay).toBe(true);
    expect(draft.time).toBe("");
    expect(draft.priority).toBe("low");
  });

  it("maps a recurring draft to a recurrence choice and keeps the rrule", () => {
    const draft = draftFromParsed(
      { title: "Pay rent", rrule: "FREQ=MONTHLY;INTERVAL=3", channels: ["telegram", "email"] },
      "critical",
    );
    expect(draft.recurrence).toBe("quarterly");
    expect(draft.customRrule).toBe("FREQ=MONTHLY;INTERVAL=3");
    expect(draft.channels).toEqual(["telegram", "email"]);
    expect(draft.priority).toBe("critical");
  });

  it("defaults missing fields sensibly", () => {
    const draft = draftFromParsed({ title: "Standup" });
    expect(draft.title).toBe("Standup");
    expect(draft.date).toBe("");
    expect(draft.priority).toBe("medium");
    expect(draft.channels).toEqual(["telegram"]);
    expect(draft.tz).toBe("UTC");
  });

  it("defaults a missing title to an empty string", () => {
    const draft = draftFromParsed({} as ParsedDraft);
    expect(draft.title).toBe("");
    expect(draft.tz).toBe("UTC");
  });
});

describe("parsedToWizardDraft", () => {
  it("guards and converts a valid parsed draft", () => {
    const result = parsedToWizardDraft({
      title: "Pay rent",
      start_at: "2026-10-01T09:00:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.title).toBe("Pay rent");
      expect(result.draft.priority).toBe("critical"); // financial hint
    }
  });

  it("returns validation errors for an invalid draft", () => {
    const result = parsedToWizardDraft({ title: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("title is required");
    }
  });

  it("returns errors for an invalid start_at", () => {
    const result = parsedToWizardDraft({
      title: "x",
      start_at: "not-a-date",
    } as ParsedDraft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("start_at must be a valid date");
    }
  });
});
