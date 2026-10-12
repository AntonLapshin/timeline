import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useTimeline } from "../viewModels/useTimeline";
import { selectNotificationStatus, useDeliveryLogs } from "../viewModels/useDeliveryLogs";
import type { EventRow, WeekGroup, MonthGroup } from "../../core/timeline";
import { isPastOccurrence } from "../../core/notificationStatus";
import type { DeliveryLog } from "../../core/eventTypes";
import { isFiltering, type EventFilter } from "../../core/searchFilter";
import type { EventRead } from "../../core/eventTypes";
import { Button } from "../atoms/Button";
import { Chip } from "../atoms/Chip";
import { Skeleton } from "../atoms/Skeleton";
import { Alert } from "../atoms/Alert";
import { EmptyState } from "../atoms/EmptyState";
import { SectionHeading } from "../molecules/SectionHeading";
import { EventCard } from "../molecules/EventCard";
import { ArrowPathIcon, CalendarDaysIcon } from "@heroicons/react/24/outline";

/** Props for {@link EventRowView}. */
export interface EventRowViewProps {
  row: EventRow;
  /** Optional callback fired when the row is clicked (opens edit). */
  onEventClick?: (event: EventRead) => void;
  /** Flat row index used for the staggered entrance delay. */
  staggerIndex?: number;
  /**
   * Delivery logs by event id. When provided, a past occurrence's card is
   * highlighted by notification state (green = sent and acknowledged,
   * amber = sent but not acknowledged, red = never sent).
   */
  logsByEvent?: ReadonlyMap<number, DeliveryLog[]>;
}

/**
 * A single event row in the timeline.
 *
 * Dumb view: renders the derived row data (priority, tag, recurrence badge,
 * time label, relative label) passed in from the view model on an
 * {@link EventCard}. No business logic — all derivation lives in
 * `src/core`.
 */
export function EventRowView({
  row,
  onEventClick,
  staggerIndex = 0,
  logsByEvent,
}: EventRowViewProps) {
  const notificationStatus = useMemo(
    () =>
      selectNotificationStatus(
        logsByEvent,
        row.event.id,
        row.startIso,
        row.event.tz,
        row.event.all_day,
      ),
    [logsByEvent, row],
  );
  return (
    <li className="list-none">
      <EventCard
        title={row.event.title}
        description={row.event.description || undefined}
        timeLabel={row.timeLabel}
        relativeLabel={
          row.relativeLabel ? (
            <span data-testid="relative-label">{row.relativeLabel}</span>
          ) : undefined
        }
        recurrenceBadge={
          row.recurrenceBadge ? (
            <Chip
              tone="violet"
              icon={<ArrowPathIcon aria-hidden className="h-3 w-3" />}
            >
              {row.recurrenceBadge}
            </Chip>
          ) : undefined
        }
        tagLabel={
          <>
            {row.tagIcon} {row.event.tags[0] ?? "untagged"}
          </>
        }
        tagClassName={row.tagColor}
        priority={row.event.priority}
        notificationStatus={notificationStatus}
        onClick={onEventClick ? () => onEventClick(row.event) : undefined}
        style={{ "--enter-delay": `${Math.min(staggerIndex, 8) * 45}ms` } as CSSProperties}
        className="animate-enter"
      />
    </li>
  );
}

/** A month group with its week buckets. */
export function MonthGroupView({
  group,
  onEventClick,
  logsByEvent,
}: {
  group: MonthGroup;
  onEventClick?: (event: EventRead) => void;
  /** Delivery logs by event id (drives the past-occurrence highlight). */
  logsByEvent?: ReadonlyMap<number, DeliveryLog[]>;
}) {
  const totalEvents = group.weeks.reduce((n, week) => n + week.rows.length, 0);
  return (
    <section>
      <SectionHeading
        title={group.label}
        eyebrow={`${totalEvents} event${totalEvents === 1 ? "" : "s"}`}
        titleAs="h2"
        className="mb-3"
      />
      {group.weeks.map((week: WeekGroup, weekIdx: number) => (
        <div key={week.key} className="mb-5 last:mb-0">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            {week.label}
          </h3>
          <ul className="space-y-2.5">
            {week.rows.map((row, rowIdx) => (
              <EventRowView
                key={`${row.event.id}-${row.startIso}`}
                row={row}
                onEventClick={onEventClick}
                staggerIndex={weekIdx * 10 + rowIdx}
                logsByEvent={logsByEvent}
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
 * renders the grouped rows plus infinite-scroll pagination. Rows are
 * revealed in batches (see `TIMELINE_PAGE_SIZE`): scrolling to the end
 * auto-loads the next batch via an `IntersectionObserver` sentinel, with the
 * "Load more" button kept as an explicit fallback. No business logic lives
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
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Past occurrences get a notification-state highlight (green = sent and
  // acknowledged, amber = sent but not acknowledged, red = never sent), so
  // fetch delivery logs for the events behind the rendered past rows.
  const pastEventIds = useMemo(() => {
    const ids = new Set<number>();
    for (const group of groups) {
      for (const week of group.weeks) {
        for (const row of week.rows) {
          if (isPastOccurrence(row.startIso, row.event.all_day)) {
            ids.add(row.event.id);
          }
        }
      }
    }
    return [...ids];
  }, [groups]);
  const logsByEvent = useDeliveryLogs(pastEventIds);

  // Infinite scroll: when the end sentinel scrolls into view, reveal the
  // next batch. Works inside any scroll container (the app scrolls `<main>`
  // internally, not the window) since IntersectionObserver observes
  // visibility, not scroll events.
  useEffect(() => {
    if (!hasMore) {
      return;
    }
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadMore, groups]);

  if (loading) {
    return (
      <div
        className="space-y-3"
        role="status"
        aria-label="Loading events"
        data-testid="timeline-loading"
      >
        <Skeleton className="h-6 w-1/3 animate-enter" />
        <Skeleton className="h-20 animate-enter" />
        <Skeleton className="h-20 animate-enter" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert tone="error" title={error}>
        <Button variant="ghost" size="sm" onClick={retry} className="mt-1">
          Retry
        </Button>
      </Alert>
    );
  }

  if (groups.length === 0) {
    const filtering = filter && isFiltering(filter);
    return (
      <EmptyState
        icon={<CalendarDaysIcon aria-hidden className="h-6 w-6" />}
        title={filtering ? "No matches." : "No events yet."}
        description={
          filtering
            ? "Try adjusting your search or filters."
            : "Create your first event to get started."
        }
        action={
          !filtering && onCreate ? (
            <Button variant="primary" onClick={onCreate}>
              + Create your first event
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div data-testid="timeline-view" className="space-y-8">
      {groups.map((group) => (
        <MonthGroupView
          key={group.key}
          group={group}
          onEventClick={onEventClick}
          logsByEvent={logsByEvent}
        />
      ))}
      {hasMore && (
        <>
          <div ref={sentinelRef} data-testid="timeline-sentinel" aria-hidden />
          <Button variant="ghost" fullWidth onClick={loadMore}>
            Load more
          </Button>
        </>
      )}
    </div>
  );
}
