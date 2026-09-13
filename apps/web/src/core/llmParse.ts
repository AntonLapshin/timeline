/**
 * LLM smart-input parsing service for the timeline web UI (issue #20).
 *
 * Pure service: wraps `fetch` (injected as a dependency) into a typed call to
 * `POST /api/events/parse`, which returns a structured event draft to be
 * confirmed before saving. The endpoint itself is implemented in a later
 * milestone; this module defines the contract the UI consumes. No React, no
 * browser globals.
 */

import type { ParsedDraft } from "./parseGuards";
import { ApiError, type FetchLike } from "./apiClient";

/** Result of a parse call: either a draft or an error message. */
export type ParseResult =
  | { ok: true; draft: ParsedDraft }
  | { ok: false; error: string };

/** The parse service bound to a base URL and a fetch implementation. */
export interface LlmParser {
  parse(text: string): Promise<ParseResult>;
}

/**
 * Build an LlmParser.
 *
 * @param baseUrl  The API base URL, e.g. `http://127.0.0.1:8123`.
 * @param fetchImpl  The fetch implementation to use (defaults to globalThis.fetch).
 */
export function createLlmParser(
  baseUrl: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): LlmParser {
  const base = baseUrl.replace(/\/+$/, "");

  return {
    async parse(text: string): Promise<ParseResult> {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetchImpl(`${base}/api/events/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } catch {
        return { ok: false, error: "network error while parsing" };
      }
      if (!res.ok) {
        throw new ApiError(res.status, `API parse failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as ParsedDraft;
      return { ok: true, draft: data };
    },
  };
}
