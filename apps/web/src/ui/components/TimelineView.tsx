import { useTimeline } from "../viewModels/useTimeline";
import type { EventRow, WeekGroup, MonthGroup } from "../../core/timeline";
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
        onEventClick ? "cursor-pointer hover:bg-slate-50" : ""
      }`}
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
          <span className="truncate font-medium text-slate-900">
            {row.event.title}
          </span>
          {row.recurrenceBadge && (
            <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">
              ↻ {row.recurrenceBadge}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
          <span>{row.event.description}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          <span>{row.timeLabel}</span>
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
      <h2 className="mb-2 text-lg font-semibold text-slate-900">
        {group.label}
      </h2>
      {group.weeks.map((week: WeekGroup) => (
        <div key={week.key} className="mb-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
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
}: {
  onEventClick?: (event: EventRead) => void;
}) {
  const { groups, hasMore, loading, error, loadMore } = useTimeline();

  if (loading) {
    return <p className="text-sm text-slate-500">Loading events…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (groups.length === 0) {
    return <p className="text-sm text-slate-500">No events yet.</p>;
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
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Load more
        </button>
      )}
    </div>
  );
}
