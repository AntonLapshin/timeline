import { useCalendar, type CalendarMode } from "../viewModels/useCalendar";
import {
  dayDotClasses,
  daySlots,
  toOccurrenceRow,
  weekGrid,
  type AgendaRow,
  type CalendarDay,
} from "../../core/calendar";
import { isFiltering, type EventFilter } from "../../core/searchFilter";
import type { EventOccurrence } from "../../core/eventTypes";
import { PriorityDot } from "./PriorityDot";

/** Weekday column headers (Sunday-first, matching the grid). */
const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The three Calendar sub-mode tabs. */
const MODES: Array<{ id: CalendarMode; label: string }> = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "agenda", label: "Agenda" },
];

/**
 * A single day cell in the month grid.
 *
 * Dumb view: renders the day-of-month number and one dot per occurrence
 * (up to 3, colored by each occurrence's priority via `dayDotClasses`) passed
 * in from the view model's grid, and calls `onSelect` when clicked. No
 * business logic — all derivation lives in `src/core`.
 */
export function DayCell({
  day,
  onSelect,
}: {
  day: CalendarDay;
  onSelect: (day: CalendarDay) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      aria-label={`${day.isoDate}, ${day.count} event${day.count === 1 ? "" : "s"}`}
      className={`print-month-cell flex h-16 flex-col items-center justify-start rounded-lg border p-1 text-sm leading-none transition-colors ${
        day.inMonth
          ? "border-slate-200/80 bg-white shadow-sm hover:bg-slate-50 dark:border-slate-700/70 dark:bg-slate-800 dark:hover:bg-slate-700/80"
          : "border-transparent bg-slate-100/60 text-slate-300 dark:bg-slate-800/40 dark:text-slate-600"
      }`}
    >
      <span className={`font-medium ${day.inMonth ? "text-slate-700 dark:text-slate-200" : ""}`}>
        {day.dayOfMonth}
      </span>
      {day.count > 0 && (
        <span className="mt-1 flex flex-wrap justify-center gap-0.5">
          {dayDotClasses(day).map((dotClass, i) => (
            <span
              key={`${day.isoDate}-dot-${i}`}
              aria-hidden
              className={`h-2 w-2 rounded-full ring-1 ring-white/60 dark:ring-white/20 ${dotClass}`}
            />
          ))}
          {day.count > 3 && (
            <span className="text-[10px] font-medium leading-none text-slate-500 dark:text-slate-400">
              +{day.count - 3}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/** A single occurrence row inside the day drawer. */
export function OccurrenceRowView({
  day,
  onEventClick,
}: {
  day: CalendarDay;
  onEventClick?: (event: EventOccurrence) => void;
}) {
  return (
    <ul className="space-y-2">
      {day.occurrences.map((o) => {
        const row = toOccurrenceRow(o);
        return (
          <li
            key={`${o.event_id}-${o.start_at}`}
            className={`card flex items-start gap-3 p-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
              onEventClick ? "cursor-pointer" : ""
            }`}
            onClick={onEventClick ? () => onEventClick(o) : undefined}
          >
            <PriorityDot priority={o.priority} size="md" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium tracking-tight text-slate-900 dark:text-slate-100">
                  {row.occurrence.title}
                </span>
                {row.recurrenceBadge && (
                  <span className="chip shrink-0 border-violet-200 bg-violet-50/80 text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300">
                    ↻ {row.recurrenceBadge}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs leading-4 text-slate-500 dark:text-slate-400">
                <span>{row.timeLabel}</span>
                {row.relativeLabel && (
                  <span
                    data-testid="relative-label"
                    className="chip border-slate-200 bg-slate-100/70 text-slate-600 dark:border-slate-600/60 dark:bg-slate-700/50 dark:text-slate-300"
                  >
                    {row.relativeLabel}
                  </span>
                )}
                {row.nextOccurrenceLabel && (
                  <span className="text-slate-400 dark:text-slate-500">{row.nextOccurrenceLabel}</span>
                )}
              </div>
            </div>
            {row.occurrence.tag && (
              <span
                className={`chip shrink-0 ${row.tagColor}`}
              >
                {row.tagIcon} {row.occurrence.tag}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A single occurrence chip inside a week-grid day column. */
export function WeekChip({
  row,
  onEventClick,
}: {
  row: ReturnType<typeof toOccurrenceRow>;
  onEventClick?: (event: EventOccurrence) => void;
}) {
  return (
    <div
      className={`flex w-full items-center gap-1.5 truncate rounded-lg border border-transparent px-1.5 py-1 text-left text-[11px] leading-4 shadow-sm ${row.priorityColor} ${
        onEventClick ? "cursor-pointer" : ""
      }`}
      title={row.occurrence.title}
      onClick={onEventClick ? () => onEventClick(row.occurrence) : undefined}
    >
      <PriorityDot priority={row.occurrence.priority} size="sm" className="h-2.5 w-2.5" />
      <span className="truncate">
        {!row.occurrence.all_day && <span className="font-semibold">{row.timeLabel} </span>}
        {row.occurrence.title}
      </span>
    </div>
  );
}

/** The week grid: 7 day columns with all-day/timed event chips. */
export function WeekGrid({
  week,
  onEventClick,
}: {
  week: ReturnType<typeof weekGrid>;
  onEventClick?: (event: EventOccurrence) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {week.days.map((day) => {
        const { allDay, timed } = daySlots(day);
        return (
          <div
            key={day.isoDate}
            className="min-h-24 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="text-center text-xs font-medium text-slate-400 dark:text-slate-500">
              {day.dayOfMonth}
            </div>
            <div className="mt-1 space-y-1">
              {allDay.map((o) => (
                <WeekChip key={`${o.event_id}-${o.start_at}`} row={toOccurrenceRow(o)} onEventClick={onEventClick} />
              ))}
              {timed.map((o) => (
                <WeekChip key={`${o.event_id}-${o.start_at}`} row={toOccurrenceRow(o)} onEventClick={onEventClick} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A single agenda row: date, title, time, priority, recurrence badge. */
export function AgendaRowView({
  row,
  onEventClick,
}: {
  row: AgendaRow;
  onEventClick?: (event: EventOccurrence) => void;
}) {
  return (
    <li
      className={`card flex items-start gap-3 p-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
        onEventClick ? "cursor-pointer" : ""
      }`}
      onClick={onEventClick ? () => onEventClick(row.occurrence) : undefined}
    >
      <PriorityDot priority={row.occurrence.priority} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium tracking-tight text-slate-900 dark:text-slate-100">
            {row.occurrence.title}
          </span>
          {row.recurrenceBadge && (
            <span className="chip shrink-0 border-violet-200 bg-violet-50/80 text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300">
              ↻ {row.recurrenceBadge}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs leading-4 text-slate-500 dark:text-slate-400">
          <span>{row.dateLabel}</span>
          <span>·</span>
          <span>{row.timeLabel}</span>
          {row.relativeLabel && (
            <span className="chip border-slate-200 bg-slate-100/70 text-slate-600 dark:border-slate-600/60 dark:bg-slate-700/50 dark:text-slate-300">
              {row.relativeLabel}
            </span>
          )}
        </div>
      </div>
      {row.occurrence.tag && (
        <span
          className={`chip shrink-0 ${row.tagColor}`}
        >
          {row.tagIcon} {row.occurrence.tag}
        </span>
      )}
    </li>
  );
}

/** The agenda list with a clear empty state. */
export function AgendaList({
  rows,
  onEventClick,
}: {
  rows: AgendaRow[];
  onEventClick?: (event: EventOccurrence) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="card border-dashed p-8 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No upcoming events. Enjoy the calm!
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <AgendaRowView
          key={`${row.occurrence.event_id}-${row.occurrence.start_at}`}
          row={row}
          onEventClick={onEventClick}
        />
      ))}
    </ul>
  );
}

/**
 * The Calendar view (month/week/agenda sub-modes + day drawer).
 *
 * A thin, dumb view: it calls the `useCalendar` view model for state and
 * renders the sub-mode switcher, the mode-appropriate navigation header and
 * content, and the day drawer for the selected day. No business logic lives
 * here.
 */
export function CalendarView({
  onEventClick,
  filter,
  refreshKey,
}: {
  onEventClick?: (event: EventOccurrence) => void;
  filter?: EventFilter;
  /** Bump to re-run the occurrence fetch (e.g. after a wizard save, issue #121). */
  refreshKey?: number;
}) {
  const {
    mode,
    setMode,
    grid,
    week,
    agenda,
    monthLabel: label,
    weekLabel,
    selectedDay,
    loading,
    error,
    retry,
    prevMonth,
    nextMonth,
    prevWeek,
    nextWeek,
    selectDay,
    closeDrawer,
  } = useCalendar(filter, refreshKey);

  const navigation =
    mode === "week"
      ? { prev: prevWeek, next: nextWeek, title: weekLabel }
      : { prev: prevMonth, next: nextMonth, title: label };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-slate-200/70 bg-slate-100/70 p-1 print-hidden dark:border-slate-700/70 dark:bg-slate-800/70">
        {MODES.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={mode === tab.id}
            onClick={() => setMode(tab.id)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium leading-none transition-colors ${
              mode === tab.id
                ? "bg-white text-slate-900 shadow-md dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/40"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between print-hidden">
        <button
          type="button"
          onClick={navigation.prev}
          aria-label="Previous"
          className="btn-ghost px-3 py-1.5"
        >
          ←
        </button>
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{navigation.title}</h2>
        <button
          type="button"
          onClick={navigation.next}
          aria-label="Next"
          className="btn-ghost px-3 py-1.5"
        >
          →
        </button>
      </div>

      {error && (
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
      )}
      {loading && (
        <div
          className="space-y-3"
          role="status"
          aria-label="Loading calendar"
          data-testid="calendar-loading"
        >
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_HEADERS.map((day) => (
              <div
                key={day}
                className="h-3 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700"
              />
            ))}
          </div>
          <div className="space-y-1">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, j) => (
                  <div
                    key={j}
                    className="h-16 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700"
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && mode === "month" && (
        <>
          <div className="grid grid-cols-7 gap-1 print-hidden">
            {WEEKDAY_HEADERS.map((day) => (
              <div
                key={day}
                className="text-center text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="space-y-1 print-month-grid">
            {grid.weeks.map((weekRow) => (
              <div key={weekRow.key} className="grid grid-cols-7 gap-1">
                {weekRow.days.map((day) => (
                  <DayCell key={day.isoDate} day={day} onSelect={selectDay} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && !error && mode === "week" && week && (
        <WeekGrid week={week} onEventClick={onEventClick} />
      )}

      {!loading && !error && mode === "agenda" && agenda &&
        (agenda.length === 0 && filter && isFiltering(filter) ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No matches.</p>
        ) : (
          <AgendaList rows={agenda} onEventClick={onEventClick} />
        ))}

      {selectedDay && (
        <div
          className="card bg-slate-50/80 p-4 backdrop-blur print-hidden dark:bg-slate-800/90"
          role="dialog"
          aria-label={`Events on ${selectedDay.isoDate}`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {selectedDay.isoDate}
            </h3>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close"
              className="btn-ghost px-2 py-1 text-sm leading-none"
            >
              ✕
            </button>
          </div>
          {selectedDay.count === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No events this day.</p>
          ) : (
            <OccurrenceRowView day={selectedDay} onEventClick={onEventClick} />
          )}
        </div>
      )}
    </div>
  );
}
