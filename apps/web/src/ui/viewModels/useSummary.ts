import { useEffect, useMemo, useState } from "react";
import { useServices } from "../services/useServices";
import { summaryBar } from "../../core/summaryCounts";
import { monthKey } from "../../core/calendar";
import type { SummaryResponse } from "../../core/eventTypes";

/** State shape produced by the summary view model. */
export interface SummaryState {
  /** The raw summary payload (month, total, by_priority), or null. */
  summary: SummaryResponse | null;
  /** The derived summary-bar model, or null when nothing loaded yet. */
  model: ReturnType<typeof summaryBar> | null;
  /** Whether the summary is still loading. */
  loading: boolean;
  /** A human error message, or null when there is none. */
  error: string | null;
}

/**
 * Thin view model for the summary bar (issue #37).
 *
 * No business logic here — it fetches the current month's summary through the
 * injected `apiClient` and delegates all derivation to the pure
 * `src/core/summaryCounts`. The component renders the resulting model.
 */
export function useSummary(
  /** Bump to re-run the summary fetch (e.g. after a wizard save, issue #121). */
  refreshKey = 0,
): SummaryState {
  const { apiClient } = useServices();
  const today = new Date();
  const month = monthKey(today.getFullYear(), today.getMonth() + 1);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .getSummary(month)
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load summary");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `refreshKey` re-runs the fetch so a wizard save is reflected in the
    // summary without a reload (issue #121).
  }, [apiClient, month, refreshKey]);

  const model = useMemo(
    () => (summary ? summaryBar(summary, new Date()) : null),
    [summary],
  );

  return { summary, model, loading, error };
}
