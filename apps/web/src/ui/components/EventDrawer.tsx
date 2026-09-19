import { useEffect, useState } from "react";
import type { EventDrawerState } from "../viewModels/useEventDrawer";
import { EVENT_CHANNELS } from "../../core/eventTypes";
import { tagStyle } from "../../core/timeline";
import { formatRecurrence } from "../../core/recurrenceFormat";
import { PriorityDot } from "./PriorityDot";

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
  /** Called after the selected event has been successfully deleted. */
  onDeleted?: () => void;
}

/**
 * The read-only event drawer as a right-side slide-over panel (issue #38,
 * reworked into a slide-over in issue #122).
 *
 * A thin, dumb view: it renders the fixed slide-over shell (dimmed backdrop,
 * right-anchored panel, slide-in animation) and the selected event's details
 * (title, priority, tag, recurrence, notes), its next occurrences, and a
 * reminder preview — all derived in `src/core`. Closes via the ✕ button, the
 * Esc key (handled in the view model) or a backdrop click. Body-scroll
 * locking lives in the view model. No business logic lives here.
 */
export function EventDrawer({ drawer, onEdit, onDeleted }: EventDrawerProps) {
  const {
    event,
    loading,
    error,
    preview,
    occurrences,
    deliveries,
    deliveriesLoading,
    deliveriesError,
  } = drawer;
  const deleting = drawer.deleting ?? false;
  const deleteError = drawer.deleteError ?? null;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset the two-step delete confirmation whenever a different event is
  // selected so a stale confirmation can never delete the wrong event.
  useEffect(() => {
    setConfirmingDelete(false);
  }, [event?.id]);

  // With a slide-over, the panel only renders when an event is selected —
  // the app composition only mounts it while the drawer is open.
  if (!event) {
    return null;
  }

  const handleConfirmDelete = async () => {
    const deleteCurrent = drawer.deleteCurrent;
    if (typeof deleteCurrent === "function") {
      const ok = await deleteCurrent();
      if (ok) {
        setConfirmingDelete(false);
        onDeleted?.();
      }
    } else {
      // Back-compat for view-model doubles that predate delete support.
      onDeleted?.();
    }
  };

  const badge = formatRecurrence(event.rrule);
  const firstTag = event.tags.length > 0 ? event.tags[0] : null;
  const tag = firstTag ? tagStyle(firstTag) : null;

  return (
    <>
      {/* Dimmed backdrop: click to close. Sits below the panel (z-40 vs
          z-50) and below the wizard modal so the wizard can stack on top. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 animate-[drawer-fade-in_200ms_ease-out] bg-slate-950/50 backdrop-blur-[2px] dark:bg-black/70"
        data-testid="event-drawer-backdrop"
        onClick={drawer.close}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto animate-[drawer-slide-in_200ms_ease-out] border-l border-slate-200/70 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-900/95 dark:shadow-black/50"
        role="dialog"
        aria-modal="true"
        aria-label={`Event: ${event.title}`}
        data-testid="event-drawer"
      >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <PriorityDot priority={event.priority} size="md" />
            <h2 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {event.title}
            </h2>
            {badge.known && (
              <span className="chip shrink-0 border-violet-200 bg-violet-50/80 text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300">
                ↻ {badge.label}
              </span>
            )}
          </div>
          {firstTag && (
            <span
              className={`chip mt-1.5 ${tag?.color}`}
            >
              {tag?.icon} {firstTag}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={drawer.close}
          aria-label="Close event drawer"
          className="btn-ghost px-2 py-1 text-sm leading-none"
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
                  className="chip border-slate-200 bg-slate-100/70 text-slate-700 dark:border-slate-600/60 dark:bg-slate-700/50 dark:text-slate-300"
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
              className="flex items-start gap-3 rounded-lg border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-700/70 dark:bg-slate-800/60"
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

      <h3 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Delivery log
      </h3>
      {deliveriesError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{deliveriesError}</p>
      ) : deliveriesLoading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading delivery log…</p>
      ) : deliveries.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No deliveries yet.</p>
      ) : (
        <ul className="space-y-2">
          {deliveries.map((row) => (
            <li
              key={row.log.id}
              className="flex items-start gap-3 rounded-lg border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-700/70 dark:bg-slate-800/60"
            >
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold leading-none shadow-sm ${row.statusStyle.color}`}
              >
                {row.statusStyle.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {row.statusLabel}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {row.timeLabel}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {row.detailLabel}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="btn-ghost mt-4 w-full px-4 py-2"
        >
          Edit event
        </button>
      )}

      {!confirmingDelete ? (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="btn mt-2 w-full border border-red-200 bg-white px-4 py-2 text-red-700 shadow-sm hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Delete event
        </button>
      ) : (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50/80 p-3 dark:border-red-500/30 dark:bg-red-950/40">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Delete this event? This cannot be undone.
          </p>
          {deleteError && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
              {deleteError}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="btn flex-1 bg-gradient-to-b from-red-500 to-red-700 px-4 py-2 text-white shadow-md shadow-red-600/25"
            >
              {deleting ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="btn-ghost flex-1 px-4 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {deleteError && !confirmingDelete && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {deleteError}
        </p>
      )}
      </aside>
    </>
  );
}
