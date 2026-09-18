/**
 * Typed API client for the timeline web UI (issue #20).
 *
 * Pure service: wraps `fetch` (injected as a dependency so this module stays
 * testable and free of browser globals) into typed methods for the documented
 * endpoints: `GET/POST /api/events`, `GET/PATCH/DELETE /api/events/{id}`,
 * and `GET /api/summary?month=YYYY-MM`. No React, no direct browser API access.
 */

import type {
  DeliveryLog,
  EventCreate,
  EventOccurrence,
  EventRead,
  EventUpdate,
  SummaryResponse,
} from "./eventTypes";

/** A minimal fetch-compatible function (injected, not imported). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Error thrown when the API responds with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function assertOk(res: { ok: boolean; status: number }, action: string): void {
  if (!res.ok) {
    throw new ApiError(res.status, `API ${action} failed (HTTP ${res.status})`);
  }
}

/** A typed client bound to a base URL and a fetch implementation. */
export interface ApiClient {
  listEvents(): Promise<EventRead[]>;
  getEvent(id: number): Promise<EventRead>;
  createEvent(payload: EventCreate): Promise<EventRead>;
  updateEvent(id: number, payload: EventUpdate): Promise<EventRead>;
  deleteEvent(id: number): Promise<void>;
  getSummary(month: string): Promise<SummaryResponse>;
  getOccurrences(month: string): Promise<EventOccurrence[]>;
  getEventDeliveries(id: number): Promise<DeliveryLog[]>;
}

/**
 * Build an ApiClient.
 *
 * @param baseUrl  The API base URL, e.g. `http://127.0.0.1:8123`.
 * @param fetchImpl  The fetch implementation to use (defaults to globalThis.fetch).
 */
export function createApiClient(
  baseUrl: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function request<T>(
    path: string,
    action: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    assertOk(res, action);
    return (await res.json()) as T;
  }

  return {
    async listEvents(): Promise<EventRead[]> {
      return request<EventRead[]>("/api/events", "list events");
    },
    async getEvent(id: number): Promise<EventRead> {
      return request<EventRead>(`/api/events/${id}`, "get event");
    },
    async createEvent(payload: EventCreate): Promise<EventRead> {
      return request<EventRead>("/api/events", "create event", {
        method: "POST",
        body: payload,
      });
    },
    async updateEvent(id: number, payload: EventUpdate): Promise<EventRead> {
      return request<EventRead>(`/api/events/${id}`, "update event", {
        method: "PATCH",
        body: payload,
      });
    },
    async deleteEvent(id: number): Promise<void> {
      // DELETE returns 204 No Content (no JSON body), so bypass the JSON
      // `request()` helper and only assert the status.
      const res = await fetchImpl(`${base}/api/events/${id}`, {
        method: "DELETE",
      });
      assertOk(res, "delete event");
    },
    async getSummary(month: string): Promise<SummaryResponse> {
      return request<SummaryResponse>(
        `/api/summary?month=${encodeURIComponent(month)}`,
        "get summary",
      );
    },
    async getOccurrences(month: string): Promise<EventOccurrence[]> {
      return request<EventOccurrence[]>(
        `/api/events/occurrences?month=${encodeURIComponent(month)}`,
        "get occurrences",
      );
    },
    async getEventDeliveries(id: number): Promise<DeliveryLog[]> {
      return request<DeliveryLog[]>(
        `/api/events/${id}/deliveries`,
        "get event deliveries",
      );
    },
  };
}
