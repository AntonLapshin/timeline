import { useSummary } from "../viewModels/useSummary";
import type { EventPriority } from "../../core/eventTypes";
import { PRIORITY_ORDER } from "../../core/summaryCounts";
import { priorityStyle } from "../../core/timeline";

/** Human labels for each priority level. */
const PRIORITY_LABELS: Record<EventPriority, string> = {
  critical: "Critical",
  medium: "Medium",
  low: "Low",
};

/**
 * The summary bar (issue #37).
 *
 * A thin, dumb view: it consumes the `useSummary` view model and renders the
 * current month's total + per-priority breakdown, plus a "next 7 days" tally
 * with an overdue highlight. All derivation lives in `src/core`; no business
 * logic lives here.
 */
export function SummaryBar() {
  const { model, loading, error } = useSummary();

  if (loading) {
    return <p className="text-sm text-slate-500">Loading summary…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!model) {
    return null;
  }

  const { monthly, nextSevenDays } = model;
  const hasCounts = monthly.total > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-900">
          {monthly.total} event{monthly.total === 1 ? "" : "s"} this month
        </span>
        {hasCounts && (
          <span className="flex items-center gap-2 text-slate-500">
            {PRIORITY_ORDER.map((priority) => {
              const style = priorityStyle(priority);
              const count = monthly.byPriority[priority];
              return (
                <span
                  key={priority}
                  className={`rounded-full border px-2 py-0.5 text-xs ${style.color}`}
                  title={`${PRIORITY_LABELS[priority]}: ${count}`}
                >
                  {style.icon} {count}
                </span>
              );
            })}
          </span>
        )}
      </div>

      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          nextSevenDays.hasOverdue
            ? "bg-red-50 text-red-700 ring-1 ring-red-200"
            : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
        }`}
      >
        {nextSevenDays.hasOverdue
          ? `${nextSevenDays.overdue} overdue in next 7 days`
          : `${nextSevenDays.total} in next 7 days`}
      </span>
    </div>
  );
}
