import { useTimeline } from "../viewModels/useTimeline";
import type { EventRow, WeekGroup, MonthGroup } from "../../core/timeline";
import { isFiltering, type EventFilter } from "../../core/searchFilter";
import type { EventRead } from "../../core/eventTypes";

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
      className={`flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${
        onEventClick ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700" : ""
      } dark:border-slate-700 dark:bg-slate-800`}
      onClick={onEventClick ? () => onEventClick(row.event) : undefined}
    >
      <span
        aria-hidden
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${row.priorityColor}`}
      >
        {row.priorityIcon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-slate-900 dark:text-slate-100">
            {row.event.title}
          </span>
          {row.recurrenceBadge && (
            <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800">
              ↻ {row.recurrenceBadge}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span>{row.event.description}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{row.timeLabel}</span>
          {row.relativeLabel && (
            <span
              data-testid="relative-label"
              className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
            >
              {row.relativeLabel}
            </span>
          )}
        </div>
      </div>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${row.tagColor}`}
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
}: {
  onEventClick?: (event: EventRead) => void;
  filter?: EventFilter;
  /** Optional callback to open the create-event flow from the empty state. */
  onCreate?: () => void;
}) {
  const { groups, hasMore, loading, error, loadMore, retry } = useTimeline(filter);

  if (loading) {
    return (
      <div
        className="space-y-3"
        role="status"
        aria-label="Loading events"
        data-testid="timeline-loading"
      >
        <div className="h-5 w-1/3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/40"
        role="alert"
      >
        <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-600 dark:bg-slate-800">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {filter && isFiltering(filter) ? "No matches." : "No events yet."}
        </p>
        {(!filter || !isFiltering(filter)) && onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
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
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Load more
        </button>
      )}
    </div>
  );
}
