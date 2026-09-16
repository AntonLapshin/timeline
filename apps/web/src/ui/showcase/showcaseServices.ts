/**
 * Fake services for the component Showcase gallery (issue #56).
 *
 * Pure, React-free setup: builds a fake `Services` object (apiClient +
 * llmParser) whose methods resolve sample data per a scenario, so the real,
 * dumb components render their various states with no backend. No business
 * logic — just presentational fixtures wired through the same context-injection
 * pattern the real app uses.
 */

import type { ApiClient } from "../../core/apiClient";
import type { LlmParser } from "../../core/llmParse";
import type { Services } from "../services/context";
import type {
  DeliveryLog,
  EventOccurrence,
  EventRead,
  SummaryResponse,
} from "../../core/eventTypes";
import {
  SHOWCASE_EVENTS,
  SHOWCASE_OCCURRENCES,
  SHOWCASE_SUMMARY,
  SHOWCASE_DELIVERIES,
} from "./showcaseData";

/**
 * The data scenario a showcase gallery section renders with.
 *
 * - `"populated"` — the api returns sample events/occurrences/summary.
 * - `"empty"` — the api returns empty collections.
 * - `"error"` — the api rejects, so the component shows its error state.
 * - `"loading"` — the api never resolves, so the component shows its loading
 *   skeleton (pending forever is fine for a static gallery preview).
 */
export type ShowcaseScenario = "populated" | "empty" | "error" | "loading";

/** Build a fake `ApiClient` whose methods resolve per the given scenario. */
function createShowcaseApiClient(
  scenario: ShowcaseScenario,
): ApiClient {
  const reject = (): Promise<never> => Promise.reject(new Error("offline"));
  const pending = (): Promise<never> => new Promise<never>(() => {});
  const events =
    scenario === "populated"
      ? SHOWCASE_EVENTS
      : scenario === "empty"
        ? []
        : null;
  const occurrences =
    scenario === "populated"
      ? SHOWCASE_OCCURRENCES
      : scenario === "empty"
        ? []
        : null;
  const summary: SummaryResponse | null =
    scenario === "populated"
      ? SHOWCASE_SUMMARY
      : scenario === "empty"
        ? { month: "2026-09", total: 0, by_priority: {} }
        : null;
  const deliveries: DeliveryLog[] | null =
    scenario === "populated" ? SHOWCASE_DELIVERIES : scenario === "empty" ? [] : null;
  const fail = (): Promise<never> =>
    scenario === "loading" ? pending() : reject();

  return {
    listEvents: () =>
      events === null ? fail() : Promise.resolve(events as EventRead[]),
    getEvent: (id: number) =>
      events === null
        ? fail()
        : Promise.resolve(
            (events as EventRead[]).find((e) => e.id === id) ??
              (events as EventRead[])[0],
          ),
    createEvent: () =>
      events === null ? fail() : Promise.resolve(SHOWCASE_EVENTS[0]),
    updateEvent: () =>
      events === null ? fail() : Promise.resolve(SHOWCASE_EVENTS[0]),
    getSummary: () =>
      summary === null ? fail() : Promise.resolve(summary),
    getOccurrences: () =>
      occurrences === null
        ? fail()
        : Promise.resolve(occurrences as EventOccurrence[]),
    getEventDeliveries: () =>
      deliveries === null
        ? fail()
        : Promise.resolve(deliveries as DeliveryLog[]),
  };
}

/** A fake `LlmParser` — the showcase never actually calls the LLM. */
const SHOWCASE_LLM_PARSER: LlmParser = {
  parse: () => Promise.resolve({ ok: false, error: "demo only" }),
};

/** Build the injected `Services` for a given showcase scenario. */
export function createShowcaseServices(
  scenario: ShowcaseScenario = "populated",
): Services {
  return {
    apiClient: createShowcaseApiClient(scenario),
    llmParser: SHOWCASE_LLM_PARSER,
  };
}
