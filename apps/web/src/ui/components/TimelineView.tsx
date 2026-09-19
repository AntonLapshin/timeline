import { useTimeline } from "../viewModels/useTimeline";
import type { EventRow, WeekGroup, MonthGroup } from "../../core/timeline";
import { isFiltering, type EventFilter } from "../../core/searchFilter";
import type { EventRead } from "../../core/eventTypes";
import { PriorityDot } from "./PriorityDot";

/**
 * A single event row in the timeline.
 *
 * Dumb view: renders the derived row data (priority color/icon, tag
 * color/icon, recurrence badge, time label) passed in from the view model. No
 * business logic — all derivation lives in `src/core`.
 */
export function EventRowView({
  row,
  onEventClick,
}: {
  row: EventRow;
  /** Optional callback fired when the row is clicked (opens edit). */
  onEventClick?: (event: EventRead) => void;
}) {
  return (
    <li
      className={`card group flex items-start gap-3 p-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
        onEventClick ? "cursor-pointer" : ""
      }`}
      onClick={onEventClick ? () => onEventClick(row.event) : undefined}
    >
      <PriorityDot priority={row.event.priority} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium tracking-tight text-slate-900 dark:text-slate-100">
            {row.event.title}
          </span>
          {row.recurrenceBadge && (
            <span className="chip shrink-0 border-violet-200 bg-violet-50/80 text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300">
              ↻ {row.recurrenceBadge}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span>{row.event.description}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-xs leading-4 text-slate-500 dark:text-slate-400">
          <span>{row.timeLabel}</span>
          {row.relativeLabel && (
            <span
              data-testid="relative-label"
              className="chip border-slate-200 bg-slate-100/70 text-slate-600 dark:border-slate-600/60 dark:bg-slate-700/50 dark:text-slate-300"
            >
              {row.relativeLabel}
            </span>
          )}
        </div>
      </div>
      <span
        className={`chip shrink-0 ${row.tagColor}`}
      >
        {row.tagIcon} {row.event.tags[0] ?? "untagged"}
      </span>
    </li>
  );
}

/** A month group with its week buckets. */
export function MonthGroupView({
  group,
  onEventClick,
}: {
  group: MonthGroup;
  onEventClick?: (event: EventRead) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
        {group.label}
      </h2>
      {group.weeks.map((week: WeekGroup) => (
        <div key={week.key} className="mb-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {week.label}
          </h3>
          <ul className="space-y-2">
            {week.rows.map((row) => (
              <EventRowView
                key={row.event.id}
                row={row}
                onEventClick={onEventClick}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * The Timeline view.
 *
 * A thin, dumb view: it calls the `useTimeline` view model for state and
 * renders the grouped rows plus a "load more" control. No business logic lives
 * here.
 */
export function TimelineView({
  onEventClick,
  filter,
  onCreate,
  refreshKey,
}: {
  onEventClick?: (event: EventRead) => void;
  filter?: EventFilter;
  /** Optional callback to open the create-event flow from the empty state. */
  onCreate?: () => void;
  /** Bump to re-run the events fetch (e.g. after a wizard save, issue #121). */
  refreshKey?: number;
}) {
  const { groups, hasMore, loading, error, loadMore, retry } = useTimeline(
    filter,
    refreshKey,
  );

  if (loading) {
    return (
      <div
        className="space-y-3"
        role="status"
        aria-label="Loading events"
        data-testid="timeline-loading"
      >
        <div className="h-5 w-1/3 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="card border-red-200/70 bg-gradient-to-b from-red-50/80 to-white p-6 text-center dark:border-red-500/20 dark:from-red-950/40 dark:to-slate-800"
        role="alert"
      >
        <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="btn-ghost mt-3 px-4 py-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="card border-dashed p-8 text-center">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {filter && isFiltering(filter) ? "No matches." : "No events yet."}
        </p>
        {(!filter || !isFiltering(filter)) && onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="btn-primary mt-3 px-4 py-2"
          >
            + Create your first event
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <MonthGroupView key={group.key} group={group} onEventClick={onEventClick} />
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          className="btn-ghost w-full px-4 py-2"
        >
          Load more
        </button>
      )}
    </div>
  );
}
