import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createQuickParser,
  draftFromParsed,
  parseApiBody,
  parsedToWizardDraft,
  NETWORK_ERROR_MESSAGE,
  UNEXPECTED_BODY_MESSAGE,
  type ParseResult,
} from "../../src/core/quickParse";
import { parseIso, toLocalDate } from "../../src/core/dateFmt";
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quickParse core module", () => {
  it("parses text via POST /api/events/quick-parse and returns a draft", async () => {
    const draft = { title: "Pay rent", priority: "critical" };
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:8123/api/events/quick-parse");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ text: "Pay rent on the 1st" }));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          draft,
          has_explicit_date: true,
          has_explicit_time: false,
        }),
      };
    });
    const parser = createQuickParser("http://127.0.0.1:8123", fetchImpl);
    const result = (await parser.parse("Pay rent on the 1st")) as Extract<
      ParseResult,
      { ok: true }
    >;
    expect(result.ok).toBe(true);
    expect(result.draft).toEqual(draft);
  });

  it("strips a trailing slash from the base URL", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://127.0.0.1:8123/api/events/quick-parse");
      return {
        ok: true,
        status: 200,
        json: async () => ({ draft: { title: "X" } }),
      };
    });
    const parser = createQuickParser("http://127.0.0.1:8123/", fetchImpl);
    const result = await parser.parse("hello");
    expect(result).toEqual({ ok: true, draft: { title: "X" } });
  });

  it("defaults to globalThis.fetch when no fetch implementation is passed", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ draft: { title: "X" } }),
    }));
    vi.stubGlobal("fetch", fetchImpl);
    const parser = createQuickParser("http://127.0.0.1:8123");
    const result = await parser.parse("hello");
    expect(result).toEqual({ ok: true, draft: { title: "X" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parseApiBody rejects non-object bodies with the default message", () => {
    for (const body of [null, undefined, "a bare string", 42]) {
      const result = parseApiBody(body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(UNEXPECTED_BODY_MESSAGE);
      }
    }
  });

  it("parseApiBody rejects envelopes without a usable draft", () => {
    for (const body of [
      {},
      { draft: null },
      { draft: "not a draft" },
      { has_explicit_date: true, has_explicit_time: false },
    ]) {
      const result = parseApiBody(body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(UNEXPECTED_BODY_MESSAGE);
      }
    }
  });

  it("parseApiBody accepts the envelope and returns the draft", () => {
    const draft = { title: "Dentist", start_at: "2026-09-16T09:00:00" };
    const result = parseApiBody({
      draft,
      has_explicit_date: true,
      has_explicit_time: true,
    });
    expect(result).toEqual({ ok: true, draft });
  });

  it("returns a typed error for a 200 body without a draft envelope", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: "shape" }),
    }));
    const parser = createQuickParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("hello");
    expect(result).toEqual({ ok: false, error: UNEXPECTED_BODY_MESSAGE });
  });

  it("propagates the rejection when a 200 body is not JSON (view-model fallback)", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
    }));
    const parser = createQuickParser("http://127.0.0.1:8123", fetchImpl);
    // Only HTTP/network failures are mapped to typed results — a non-JSON
    // body on the success path rejects, and `useSmartInput`'s catch renders
    // the generic fallback.
    await expect(parser.parse("hello")).rejects.toThrow("not json");
  });

  it("returns the distinct cannot-reach-API result when fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as FetchLike;
    const parser = createQuickParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("hello");
    expect(result).toEqual({ ok: false, error: NETWORK_ERROR_MESSAGE });
  });

  it("maps any HTTP error status to a typed result instead of throwing", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const parser = createQuickParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("hello");
    expect(result).toEqual({
      ok: false,
      error:
        "Unexpected API error (HTTP 500). You can still add the event manually.",
    });
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
    expect(draft.time).toBe("");
    expect(draft.priority).toBe("medium");
    expect(draft.channels).toEqual(["telegram"]);
    expect(draft.tz).toBe("UTC");
  });

  it("uses the parsed priority as the default when present", () => {
    const draft = draftFromParsed({ title: "Standup", priority: "low" });
    expect(draft.priority).toBe("low");
  });

  it("defaults a missing title to an empty string", () => {
    const draft = draftFromParsed({} as ParsedDraft);
    expect(draft.title).toBe("");
    expect(draft.tz).toBe("UTC");
  });

  it("defaults empty channels to telegram", () => {
    const draft = draftFromParsed({ title: "X", channels: [] });
    expect(draft.channels).toEqual(["telegram"]);
  });

  it("converts an aware start into the parsed event's own zone", () => {
    // The parse carries an offset-bearing start_at plus the event's IANA tz;
    // the pre-filled wall clock must be that zone's, not the browser's.
    const draft = draftFromParsed({
      title: "Office",
      start_at: "2026-09-16T09:00:00+02:00",
      tz: "Europe/Berlin",
    });
    expect(draft.date).toBe("2026-09-16");
    expect(draft.time).toBe("09:00");
    expect(draft.tz).toBe("Europe/Berlin");
  });

  it("falls back to local parts when the parsed timezone is unparseable", () => {
    const draft = draftFromParsed({
      title: "X",
      start_at: "2026-09-05T10:00:00+00:00",
      tz: "Mars/Olympus",
    });
    const start = parseIso("2026-09-05T10:00:00+00:00") as Date;
    expect(draft.date).toBe(toLocalDate(start));
    expect(draft.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("falls back to local parts when the parse has no timezone", () => {
    const draft = draftFromParsed({
      title: "X",
      start_at: "2026-09-05T10:00:00+00:00",
    });
    const start = parseIso("2026-09-05T10:00:00+00:00") as Date;
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(draft.date).toBe(toLocalDate(start));
    expect(draft.time).toBe(
      `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    );
    expect(draft.tz).toBe("UTC");
  });

  it("blanks the date when a tz is set but start_at is missing", () => {
    const draft = draftFromParsed({ title: "X", tz: "Europe/Berlin" });
    expect(draft.date).toBe("");
    expect(draft.time).toBe("");
    expect(draft.tz).toBe("Europe/Berlin");
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

describe("draftFromParsed reminder offsets", () => {
  it("carries valid parsed offsets into the wizard pre-fill", () => {
    const draft = draftFromParsed({
      title: "Interview",
      start_at: "2026-09-22T14:46:00",
      tz: "America/New_York",
      reminder_offsets: ["15m"],
    });
    expect(draft.reminderOffsets).toEqual(["15m"]);
  });

  it("drops invalid offsets instead of pre-filling them", () => {
    const draft = draftFromParsed({
      title: "Interview",
      reminder_offsets: ["soon", "15m", 42 as unknown as string],
    });
    expect(draft.reminderOffsets).toEqual(["15m"]);
  });

  it("defaults to no offsets when reminder_offsets is absent", () => {
    const draft = draftFromParsed({ title: "Interview" });
    expect(draft.reminderOffsets).toEqual([]);
  });
});
