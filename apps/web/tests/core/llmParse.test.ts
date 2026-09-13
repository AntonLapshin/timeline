import { describe, it, expect, vi } from "vitest";
import { createLlmParser, type ParseResult } from "../../src/core/llmParse";
import type { FetchLike } from "../../src/core/apiClient";

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

  it("returns a network-error result when fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as FetchLike;
    const parser = createLlmParser("http://127.0.0.1:8123", fetchImpl);
    const result = await parser.parse("hello");
    expect(result).toEqual({ ok: false, error: "network error while parsing" });
  });

  it("throws ApiError on a non-2xx response", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));
    const parser = createLlmParser("http://127.0.0.1:8123", fetchImpl);
    await expect(parser.parse("hello")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
    });
  });
});
