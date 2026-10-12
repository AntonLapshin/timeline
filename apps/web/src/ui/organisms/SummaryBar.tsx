import { useSummary } from "../viewModels/useSummary";
import type { EventPriority } from "../../core/eventTypes";
import { PRIORITY_ORDER } from "../../core/summaryCounts";
import { PriorityDot } from "../atoms/PriorityDot";
import { StatPill } from "../molecules/StatPill";
import {
  CalendarDaysIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

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
    return (
      <div
        data-testid="summary-bar"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-sm text-slate-500 dark:text-slate-400">
          Loading summary…
        </span>
        <div aria-hidden className="flex gap-2">
          <span className="skeleton h-7 w-36" />
          <span className="skeleton h-7 w-24" />
          <span className="skeleton h-7 w-28" />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <p
        data-testid="summary-bar"
        className="text-sm text-red-600 dark:text-red-400"
      >
        {error}
      </p>
    );
  }
  if (!model) {
    return null;
  }

  const { monthly, nextSevenDays } = model;
  const hasCounts = monthly.total > 0;

  return (
    <div
      data-testid="summary-bar"
      className="flex flex-wrap items-center gap-2"
    >
      <StatPill
        tone="brand"
        icon={<CalendarDaysIcon aria-hidden className="h-3.5 w-3.5" />}
        label=""
        value={`${monthly.total} event${monthly.total === 1 ? "" : "s"} this month`}
      />
      {hasCounts &&
        PRIORITY_ORDER.map((priority) => {
          const count = monthly.byPriority[priority];
          return (
            <span
              key={priority}
              title={`${PRIORITY_LABELS[priority]}: ${count}`}
            >
              <StatPill
                icon={
                  <PriorityDot
                    priority={priority}
                    size="sm"
                    glyph={false}
                    className="h-2.5 w-2.5"
                  />
                }
                label={PRIORITY_LABELS[priority]}
                value={count}
              />
            </span>
          );
        })}
      <StatPill
        tone={nextSevenDays.hasOverdue ? "red" : "green"}
        icon={
          nextSevenDays.hasOverdue ? (
            <ExclamationTriangleIcon aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <ClockIcon aria-hidden className="h-3.5 w-3.5" />
          )
        }
        label=""
        value={
          nextSevenDays.hasOverdue
            ? `${nextSevenDays.overdue} overdue in next 7 days`
            : `${nextSevenDays.total} in next 7 days`
        }
      />
    </div>
  );
}
