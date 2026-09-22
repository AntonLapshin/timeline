import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTER,
  allMonths,
  allTags,
  eventMatchesText,
  eventMonth,
  filterEvents,
  filterOccurrences,
  isFiltering,
  normalizeQuery,
  occurrenceMatchesText,
  occurrenceMonth,
} from "../../src/core/searchFilter";
import type { EventRead, EventOccurrence } from "../../src/core/eventTypes";

function makeEvent(overrides: Partial<EventRead>): EventRead {
  return {
    id: 1,
    title: "HRA appointment",
    description: "Annual health check",
    location_url: "",
    tags: ["health", "annual"],
    type: "one_time",
    start_at: "2026-09-05T10:00:00",
    end_at: null,
    all_day: false,
    tz: "UTC",
    rrule: null,
    priority: "critical",
    channels: ["telegram"],
    reminder_offsets: [],
    remind_time_of_day: null,
    repeat_until_ack: false,
    snooze_allowed: false,
    email_enabled: false,
    email_to: null,
    source: "web",
    raw_input: null,
    ai_confidence: null,
    status: "active",
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
    ...overrides,
  };
}

function makeOccurrence(overrides: Partial<EventOccurrence>): EventOccurrence {
  return {
    event_id: 1,
    title: "HRA appointment",
    priority: "critical",
    tag: "health",
    rrule: null,
    start_at: "2026-09-05T10:00:00",
    all_day: false,
    tz: "UTC",
    next_occurrence: null,
    ...overrides,
  };
}

describe("normalizeQuery", () => {
  it("trims and lowercases", () => {
    expect(normalizeQuery("  Health Check  ")).toBe("health check");
  });
  it("returns empty for blank input", () => {
    expect(normalizeQuery("   ")).toBe("");
  });
});

describe("eventMatchesText", () => {
  const event = makeEvent({});

  it("matches on title (case-insensitive)", () => {
    expect(eventMatchesText(event, "hra")).toBe(true);
  });
  it("matches on description/notes", () => {
    expect(eventMatchesText(event, "health check")).toBe(true);
  });
  it("matches on a tag", () => {
    expect(eventMatchesText(event, "annual")).toBe(true);
  });
  it("matches everything when the query is blank", () => {
    expect(eventMatchesText(event, "   ")).toBe(true);
  });
  it("returns false when nothing matches", () => {
    expect(eventMatchesText(event, "lunch")).toBe(false);
  });
});

describe("occurrenceMatchesText", () => {
  const occurrence = makeOccurrence({});

  it("matches on title", () => {
    expect(occurrenceMatchesText(occurrence, "hra")).toBe(true);
  });
  it("matches on tag", () => {
    expect(occurrenceMatchesText(occurrence, "health")).toBe(true);
  });
  it("matches everything when the query is blank", () => {
    expect(occurrenceMatchesText(occurrence, " ")).toBe(true);
  });
  it("returns false when nothing matches", () => {
    expect(occurrenceMatchesText(occurrence, "lunch")).toBe(false);
  });
  it("handles a null tag without throwing", () => {
    expect(occurrenceMatchesText(makeOccurrence({ tag: null }), "health")).toBe(
      false,
    );
  });
});

describe("eventMonth / occurrenceMonth", () => {
  it("extracts the YYYY-MM month of an event start", () => {
    expect(eventMonth(makeEvent({}))).toBe("2026-09");
  });
  it("returns null for an unparseable event start", () => {
    expect(eventMonth(makeEvent({ start_at: "not-a-date" }))).toBeNull();
  });
  it("interprets the month in the event's own timezone", () => {
    // 2026-10-01T00:30:00Z is still Sep 30 in New York.
    expect(
      eventMonth(
        makeEvent({
          start_at: "2026-10-01T00:30:00Z",
          tz: "America/New_York",
        }),
      ),
    ).toBe("2026-09");
  });
  it("extracts the YYYY-MM month of an occurrence start", () => {
    expect(occurrenceMonth(makeOccurrence({}))).toBe("2026-09");
  });
  it("returns null for an unparseable occurrence start", () => {
    expect(occurrenceMonth(makeOccurrence({ start_at: "nope" }))).toBeNull();
  });
  it("interprets the occurrence month in its own timezone", () => {
    expect(
      occurrenceMonth(
        makeOccurrence({
          start_at: "2026-10-01T00:30:00Z",
          tz: "America/New_York",
        }),
      ),
    ).toBe("2026-09");
  });
});

describe("isFiltering", () => {
  it("is false for the empty filter", () => {
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
  });
  it("is true when text is present", () => {
    expect(isFiltering({ ...EMPTY_FILTER, text: "  hra  " })).toBe(true);
  });
  it("is true when priority is set", () => {
    expect(isFiltering({ ...EMPTY_FILTER, priority: "low" })).toBe(true);
  });
  it("is true when tag is set", () => {
    expect(isFiltering({ ...EMPTY_FILTER, tag: "health" })).toBe(true);
  });
  it("is true when month is set", () => {
    expect(isFiltering({ ...EMPTY_FILTER, month: "2026-09" })).toBe(true);
  });
});

describe("filterEvents", () => {
  const events = [
    makeEvent({
      id: 1,
      title: "HRA",
      description: "annual check",
      tags: ["health"],
      priority: "critical",
      start_at: "2026-09-05T10:00:00",
    }),
    makeEvent({
      id: 2,
      title: "Lunch",
      description: "",
      tags: ["social"],
      priority: "low",
      start_at: "2026-10-12T12:00:00",
    }),
    makeEvent({
      id: 3,
      title: "Dentist",
      description: "",
      tags: ["health"],
      priority: "medium",
      start_at: "2026-11-03T09:00:00",
    }),
  ];

  it("returns a copy (not the same reference) when no filter is active", () => {
    const result = filterEvents(events, EMPTY_FILTER);
    expect(result).toEqual(events);
    expect(result).not.toBe(events);
  });

  it("filters by text across title/notes/tags", () => {
    expect(filterEvents(events, { ...EMPTY_FILTER, text: "health" }).map((e) => e.id)).toEqual([
      1, 3,
    ]);
  });

  it("filters by priority", () => {
    expect(
      filterEvents(events, { ...EMPTY_FILTER, priority: "low" }).map((e) => e.id),
    ).toEqual([2]);
  });

  it("filters by tag", () => {
    expect(
      filterEvents(events, { ...EMPTY_FILTER, tag: "health" }).map((e) => e.id),
    ).toEqual([1, 3]);
  });

  it("filters by month", () => {
    expect(
      filterEvents(events, { ...EMPTY_FILTER, month: "2026-10" }).map((e) => e.id),
    ).toEqual([2]);
  });

  it("combines text and priority with AND semantics", () => {
    expect(
      filterEvents(events, { ...EMPTY_FILTER, text: "health", priority: "low" }),
    ).toEqual([]);
    expect(
      filterEvents(events, { ...EMPTY_FILTER, text: "health", priority: "critical" }).map(
        (e) => e.id,
      ),
    ).toEqual([1]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterEvents(events, { ...EMPTY_FILTER, text: "zzz" })).toEqual([]);
  });
});

describe("filterOccurrences", () => {
  const occurrences = [
    makeOccurrence({
      event_id: 1,
      title: "HRA",
      priority: "critical",
      tag: "health",
      start_at: "2026-09-05T10:00:00",
    }),
    makeOccurrence({
      event_id: 2,
      title: "Lunch",
      priority: "low",
      tag: "social",
      start_at: "2026-10-12T12:00:00",
    }),
  ];

  it("returns a copy when no filter is active", () => {
    const result = filterOccurrences(occurrences, EMPTY_FILTER);
    expect(result).toEqual(occurrences);
    expect(result).not.toBe(occurrences);
  });

  it("filters by text", () => {
    expect(
      filterOccurrences(occurrences, { ...EMPTY_FILTER, text: "lunch" }).map((o) => o.event_id),
    ).toEqual([2]);
  });

  it("filters by priority", () => {
    expect(
      filterOccurrences(occurrences, { ...EMPTY_FILTER, priority: "critical" }).map(
        (o) => o.event_id,
      ),
    ).toEqual([1]);
  });

  it("filters by tag", () => {
    expect(
      filterOccurrences(occurrences, { ...EMPTY_FILTER, tag: "health" }).map(
        (o) => o.event_id,
      ),
    ).toEqual([1]);
  });

  it("filters by month", () => {
    expect(
      filterOccurrences(occurrences, { ...EMPTY_FILTER, month: "2026-10" }).map(
        (o) => o.event_id,
      ),
    ).toEqual([2]);
  });

  it("combines text and priority with AND semantics", () => {
    expect(
      filterOccurrences(occurrences, {
        ...EMPTY_FILTER,
        text: "health",
        priority: "low",
      }),
    ).toEqual([]);
    expect(
      filterOccurrences(occurrences, {
        ...EMPTY_FILTER,
        text: "health",
        priority: "critical",
      }).map((o) => o.event_id),
    ).toEqual([1]);
  });

  it("combines text and tag with AND semantics", () => {
    expect(
      filterOccurrences(occurrences, {
        ...EMPTY_FILTER,
        text: "lunch",
        tag: "health",
      }),
    ).toEqual([]);
    expect(
      filterOccurrences(occurrences, {
        ...EMPTY_FILTER,
        text: "lunch",
        tag: "social",
      }).map((o) => o.event_id),
    ).toEqual([2]);
  });
});

describe("allTags", () => {
  it("returns distinct tags sorted", () => {
    const events = [
      makeEvent({ tags: ["health", "annual"] }),
      makeEvent({ tags: ["social"] }),
      makeEvent({ tags: ["annual"] }),
    ];
    expect(allTags(events)).toEqual(["annual", "health", "social"]);
  });
  it("returns empty for no events/tags", () => {
    expect(allTags([])).toEqual([]);
  });
});

describe("allMonths", () => {
  it("returns distinct parseable months sorted", () => {
    const events = [
      makeEvent({ start_at: "2026-09-05T10:00:00" }),
      makeEvent({ start_at: "2026-10-12T12:00:00" }),
      makeEvent({ start_at: "2026-09-20T08:00:00" }),
    ];
    expect(allMonths(events)).toEqual(["2026-09", "2026-10"]);
  });
  it("skips unparseable starts", () => {
    expect(allMonths([makeEvent({ start_at: "nope" })])).toEqual([]);
  });
  it("returns empty for no events", () => {
    expect(allMonths([])).toEqual([]);
  });
});
