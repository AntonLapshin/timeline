import { describe, it, expect, vi } from "vitest";
import { createApiClient, ApiError, type FetchLike } from "../../src/core/apiClient";

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

describe("apiClient core module", () => {
  it("lists events via GET /api/events", async () => {
    const events = [{ id: 1, title: "HRA" }];
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://127.0.0.1:8123/api/events");
      return { ok: true, status: 200, json: async () => events };
    });
    const client = createApiClient("http://127.0.0.1:8123/", fetchImpl);
    await expect(client.listEvents()).resolves.toEqual(events);
  });

  it("gets a single event via GET /api/events/{id}", async () => {
    const event = { id: 7 };
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://127.0.0.1:8123/api/events/7");
      return { ok: true, status: 200, json: async () => event };
    });
    const client = createApiClient("http://127.0.0.1:8123", fetchImpl);
    await expect(client.getEvent(7)).resolves.toEqual(event);
  });

  it("creates an event via POST /api/events with a JSON body", async () => {
    const created = { id: 9, title: "New" };
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:8123/api/events");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(
        JSON.stringify({ title: "New", type: "one_time", start_at: "2026-09-20T10:00:00" }),
      );
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      return { ok: true, status: 201, json: async () => created };
    });
    const client = createApiClient("http://127.0.0.1:8123", fetchImpl);
    await expect(
      client.createEvent({
        title: "New",
        type: "one_time",
        start_at: "2026-09-20T10:00:00",
      }),
    ).resolves.toEqual(created);
  });

  it("updates an event via PATCH /api/events/{id} with a JSON body", async () => {
    const updated = { id: 9, title: "Renamed" };
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:8123/api/events/9");
      expect(init?.method).toBe("PATCH");
      expect(init?.body).toBe(
        JSON.stringify({ title: "Renamed", priority: "critical" }),
      );
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      return { ok: true, status: 200, json: async () => updated };
    });
    const client = createApiClient("http://127.0.0.1:8123", fetchImpl);
    await expect(
      client.updateEvent(9, { title: "Renamed", priority: "critical" }),
    ).resolves.toEqual(updated);
  });

  it("gets a summary with an encoded month param", async () => {
    const summary = { month: "2026-09", total: 12, by_priority: {} };
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://127.0.0.1:8123/api/summary?month=2026-09");
      return { ok: true, status: 200, json: async () => summary };
    });
    const client = createApiClient("http://127.0.0.1:8123", fetchImpl);
    await expect(client.getSummary("2026-09")).resolves.toEqual(summary);
  });

  it("gets occurrences with an encoded month param", async () => {
    const occurrences = [
      { event_id: 1, title: "HRA", priority: "critical", start_at: "2026-09-05T10:00:00" },
    ];
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://127.0.0.1:8123/api/events/occurrences?month=2026-09");
      return { ok: true, status: 200, json: async () => occurrences };
    });
    const client = createApiClient("http://127.0.0.1:8123", fetchImpl);
    await expect(client.getOccurrences("2026-09")).resolves.toEqual(occurrences);
  });

  it("gets an event's delivery log via GET /api/events/{id}/deliveries", async () => {
    const deliveries = [
      { id: 1, event_id: 1, status: "sent", created_at: "2026-09-01T09:00:00" },
    ];
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://127.0.0.1:8123/api/events/7/deliveries");
      return { ok: true, status: 200, json: async () => deliveries };
    });
    const client = createApiClient("http://127.0.0.1:8123", fetchImpl);
    await expect(client.getEventDeliveries(7)).resolves.toEqual(deliveries);
  });

  it("propagates a fetch rejection (network error) from request()", async () => {
    const networkError = new Error("fetch failed");
    const fetchImpl = mockFetch(() => {
      throw networkError;
    });
    const client = createApiClient("http://127.0.0.1:8123", fetchImpl);
    await expect(client.listEvents()).rejects.toBe(networkError);
  });

  it("throws ApiError with the status on a failed response", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const client = createApiClient("http://127.0.0.1:8123", fetchImpl);
    await expect(client.listEvents()).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
  });

  it("exposes a descriptive message on ApiError", () => {
    const error = new ApiError(404, "not found");
    expect(error.status).toBe(404);
    expect(error.message).toContain("not found");
    expect(error.name).toBe("ApiError");
  });
});
