import { useEffect, useState } from "react";
import type { EventDrawerState } from "../viewModels/useEventDrawer";
import { EVENT_CHANNELS } from "../../core/eventTypes";
import { channelLabel } from "../../core/utils";
import { tagStyle } from "../../core/timeline";
import { formatRecurrence } from "../../core/recurrenceFormat";
import { PriorityDot } from "../atoms/PriorityDot";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Chip } from "../atoms/Chip";
import { ArrowPathIcon, XMarkIcon } from "@heroicons/react/24/outline";

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
 *
 * NOTE: this deliberately keeps its own backdrop/panel markup instead of the
 * shared `SlideOver` molecule — `tests/ui/EventDrawer.test.tsx` asserts the
 * `event-drawer-backdrop` test id and the panel's fixed/right-anchored
 * classes, and `SlideOver`'s internal backdrop carries no test id.
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
        className="fixed inset-0 z-40 animate-fade bg-ink-950/60 backdrop-blur-[2px] dark:bg-black/70"
        data-testid="event-drawer-backdrop"
        onClick={drawer.close}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md animate-slide-in-right overflow-y-auto border-l border-slate-200/70 bg-white/95 p-6 shadow-popover backdrop-blur-xl dark:border-slate-700/70 dark:bg-ink-800/95 dark:shadow-black/50"
        role="dialog"
        aria-modal="true"
        aria-label={`Event: ${event.title}`}
        data-testid="event-drawer"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <PriorityDot priority={event.priority} size="md" />
              <h2 className="truncate font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {event.title}
              </h2>
              {badge.known && (
                <Chip
                  tone="violet"
                  className="shrink-0"
                  icon={<ArrowPathIcon aria-hidden className="h-3 w-3" />}
                >
                  {badge.label}
                </Chip>
              )}
            </div>
            {firstTag && (
              <span className={`chip mt-1.5 ${tag?.color}`}>
                {tag?.icon} {firstTag}
              </span>
            )}
          </div>
          <IconButton label="Close event drawer" onClick={drawer.close}>
            <XMarkIcon className="h-4 w-4" />
          </IconButton>
        </div>

        {event.description && (
          <p className="mb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {event.description}
          </p>
        )}

        <section className="mb-4 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-700/50 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Reminders
          </h3>
          {preview && preview.hasReminders ? (
            <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Channels:</span>
                {EVENT_CHANNELS.filter((c) => preview.channels.includes(c)).map(
                  (c) => (
                    <Chip key={c} tone="slate">
                      {channelLabel(c)}
                    </Chip>
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
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No reminders configured.
            </p>
          )}
        </section>

        <section className="mb-4 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-700/50 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Next occurrences
          </h3>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Loading occurrences…
            </p>
          ) : occurrences.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No upcoming occurrences.
            </p>
          ) : (
            <ul className="space-y-2">
              {occurrences.map(({ occurrence, row }) => (
                <li
                  key={`${occurrence.event_id}-${occurrence.start_at}`}
                  className="flex items-start gap-3 rounded-xl border border-slate-200/70 bg-white p-3 shadow-sm dark:border-slate-700/70 dark:bg-ink-800"
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
        </section>

        <section className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-700/50 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Delivery log
          </h3>
          {deliveriesError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {deliveriesError}
            </p>
          ) : deliveriesLoading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Loading delivery log…
            </p>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No deliveries yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {deliveries.map((row) => (
                <li
                  key={row.log.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-200/70 bg-white p-3 shadow-sm dark:border-slate-700/70 dark:bg-ink-800"
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
        </section>

        {onEdit && (
          <Button
            type="button"
            variant="ghost"
            fullWidth
            onClick={onEdit}
            className="mt-5"
          >
            Edit event
          </Button>
        )}

        {!confirmingDelete ? (
          <Button
            type="button"
            variant="danger"
            fullWidth
            onClick={() => setConfirmingDelete(true)}
            className="mt-2"
          >
            Delete event
          </Button>
        ) : (
          <div className="mt-2 rounded-2xl border border-red-200 bg-red-50/80 p-4 dark:border-red-500/30 dark:bg-red-950/40">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              Delete this event? This cannot be undone.
            </p>
            {deleteError && (
              <p
                className="mt-1 text-sm text-red-600 dark:text-red-400"
                role="alert"
              >
                {deleteError}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="danger-solid"
                fullWidth
                loading={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
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
