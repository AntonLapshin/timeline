import type { EventDrawerState } from "../viewModels/useEventDrawer";
import { EVENT_CHANNELS } from "../../core/eventTypes";
import { priorityStyle, tagStyle } from "../../core/timeline";
import { formatRecurrence } from "../../core/recurrenceFormat";

/** Human labels for each reminder channel. */
const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  email: "Email",
};

/** Props for the event drawer. */
export interface EventDrawerProps {
  /** The event-drawer view-model state. */
  drawer: EventDrawerState;
  /** Called when the user wants to edit the selected event. */
  onEdit?: () => void;
}

/**
 * The read-only event drawer (issue #38).
 *
 * A thin, dumb view: it renders the selected event's details (title, priority,
 * tag, recurrence, notes), its next occurrences, and a reminder preview — all
 * derived in `src/core`. Closes via the ✕ button or the Esc key (handled in
 * the view model). No business logic lives here.
 */
export function EventDrawer({ drawer, onEdit }: EventDrawerProps) {
  const { event, loading, error, preview, occurrences } = drawer;

  if (!event) {
    return (
      <div
        className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-600 dark:bg-slate-800"
        role="status"
        data-testid="event-drawer-empty"
      >
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Select an event to see its details.
        </p>
      </div>
    );
  }

  const priority = priorityStyle(event.priority);
  const badge = formatRecurrence(event.rrule);
  const firstTag = event.tags.length > 0 ? event.tags[0] : null;
  const tag = firstTag ? tagStyle(firstTag) : null;

  return (
    <aside
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      role="dialog"
      aria-label={`Event: ${event.title}`}
      data-testid="event-drawer"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${priority.color}`}
            >
              {priority.icon}
            </span>
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
              {event.title}
            </h2>
            {badge.known && (
              <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800">
                ↻ {badge.label}
              </span>
            )}
          </div>
          {firstTag && (
            <span
              className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${tag?.color}`}
            >
              {tag?.icon} {firstTag}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={drawer.close}
          aria-label="Close event drawer"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          ✕
        </button>
      </div>

      {event.description && (
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{event.description}</p>
      )}

      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Reminders
      </h3>
      {preview && preview.hasReminders ? (
        <div className="mb-4 space-y-1 text-sm text-slate-700 dark:text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Channels:</span>
            {EVENT_CHANNELS.filter((c) => preview.channels.includes(c)).map(
              (c) => (
                <span
                  key={c}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                >
                  {CHANNEL_LABELS[c] ?? c}
                </span>
              ),
            )}
          </div>
          {preview.offsetsLabel && (
            <div>
              <span className="font-medium">Offsets:</span>{" "}
              {preview.offsetsLabel}
            </div>
          )}
          {preview.timeOfDay && (
            <div>
              <span className="font-medium">Remind at:</span>{" "}
              {preview.timeOfDay}
            </div>
          )}
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">No reminders configured.</p>
      )}

      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Next occurrences
      </h3>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading occurrences…</p>
      ) : occurrences.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No upcoming occurrences.</p>
      ) : (
        <ul className="space-y-2">
          {occurrences.map(({ occurrence, row }) => (
            <li
              key={`${occurrence.event_id}-${occurrence.start_at}`}
              className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-700/40"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {row.timeLabel}
                </div>
                {row.nextOccurrenceLabel && (
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {row.nextOccurrenceLabel}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Edit event
        </button>
      )}
    </aside>
  );
}
