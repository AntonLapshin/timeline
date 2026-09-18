import { useSummary } from "../viewModels/useSummary";
import type { EventPriority } from "../../core/eventTypes";
import { PRIORITY_ORDER } from "../../core/summaryCounts";
import { PriorityDot } from "./PriorityDot";

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
export function SummaryBar({ refreshKey }: { refreshKey?: number }) {
  const { model, loading, error } = useSummary(refreshKey);

  if (loading) {
    return <p className="text-sm leading-5 text-slate-500 dark:text-slate-400">Loading summary…</p>;
  }
  if (error) {
    return <p className="text-sm leading-5 text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!model) {
    return null;
  }

  const { monthly, nextSevenDays } = model;
  const hasCounts = monthly.total > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm leading-5">
      <div className="flex items-center gap-2">
        <span className="font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {monthly.total} event{monthly.total === 1 ? "" : "s"} this month
        </span>
        {hasCounts && (
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            {PRIORITY_ORDER.map((priority) => {
              const count = monthly.byPriority[priority];
              return (
                <span
                  key={priority}
                  className="chip border-slate-200/80 bg-white/70 text-slate-600 shadow-sm dark:border-slate-600/60 dark:bg-slate-800/70 dark:text-slate-300"
                  title={`${PRIORITY_LABELS[priority]}: ${count}`}
                >
                  <PriorityDot priority={priority} size="sm" className="h-2.5 w-2.5" />
                  {count}
                </span>
              );
            })}
          </span>
        )}
      </div>

      <span
        className={`chip ${
          nextSevenDays.hasOverdue
            ? "border-red-200 bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-md shadow-red-500/25 dark:border-red-400/30"
            : "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"
        }`}
      >
        {nextSevenDays.hasOverdue
          ? `${nextSevenDays.overdue} overdue in next 7 days`
          : `${nextSevenDays.total} in next 7 days`}
      </span>
    </div>
  );
}
