import { useCalendar, type CalendarMode } from "../viewModels/useCalendar";
import {
  daySlots,
  toOccurrenceRow,
  weekGrid,
  type AgendaRow,
  type CalendarDay,
} from "../../core/calendar";
import { isFiltering, type EventFilter } from "../../core/searchFilter";
import type { EventOccurrence } from "../../core/eventTypes";

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
 * Dumb view: renders the day-of-month number and the day's occurrence count
 * (dots) passed in from the view model's grid, and calls `onSelect` when
 * clicked. No business logic — all derivation lives in `src/core`.
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
      className={`flex h-16 flex-col items-center justify-start rounded-lg border p-1 text-sm transition-colors ${
        day.inMonth
          ? "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
          : "border-transparent bg-slate-50 text-slate-300 dark:bg-slate-800/40 dark:text-slate-600"
      }`}
    >
      <span className={`font-medium ${day.inMonth ? "text-slate-700 dark:text-slate-200" : ""}`}>
        {day.dayOfMonth}
      </span>
      {day.count > 0 && (
        <span className="mt-1 flex flex-wrap justify-center gap-0.5">
          {Array.from({ length: Math.min(day.count, 3) }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-indigo-500"
            />
          ))}
          {day.count > 3 && (
            <span className="text-[10px] font-medium leading-none text-indigo-600">
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
            className={`flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${
              onEventClick ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700" : ""
            } dark:border-slate-700 dark:bg-slate-800`}
            onClick={onEventClick ? () => onEventClick(o) : undefined}
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
                  {row.occurrence.title}
                </span>
                {row.recurrenceBadge && (
                  <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800">
                    ↻ {row.recurrenceBadge}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{row.timeLabel}</span>
                {row.nextOccurrenceLabel && (
                  <span className="text-slate-400 dark:text-slate-500">{row.nextOccurrenceLabel}</span>
                )}
              </div>
            </div>
            {row.occurrence.tag && (
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${row.tagColor}`}
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
      className={`w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight ${row.priorityColor} ${
        onEventClick ? "cursor-pointer hover:brightness-95" : ""
      }`}
      title={row.occurrence.title}
      onClick={onEventClick ? () => onEventClick(row.occurrence) : undefined}
    >
      {!row.occurrence.all_day && <span className="font-medium">{row.timeLabel} </span>}
      {row.occurrence.title}
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
      className={`flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${
        onEventClick ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700" : ""
      } dark:border-slate-700 dark:bg-slate-800`}
      onClick={onEventClick ? () => onEventClick(row.occurrence) : undefined}
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
            {row.occurrence.title}
          </span>
          {row.recurrenceBadge && (
            <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800">
              ↻ {row.recurrenceBadge}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{row.dateLabel}</span>
          <span>·</span>
          <span>{row.timeLabel}</span>
        </div>
      </div>
      {row.occurrence.tag && (
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${row.tagColor}`}
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
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-600 dark:bg-slate-800">
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
}: {
  onEventClick?: (event: EventOccurrence) => void;
  filter?: EventFilter;
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
    prevMonth,
    nextMonth,
    prevWeek,
    nextWeek,
    selectDay,
    closeDrawer,
  } = useCalendar(filter);

  const navigation =
    mode === "week"
      ? { prev: prevWeek, next: nextWeek, title: weekLabel }
      : { prev: prevMonth, next: nextMonth, title: label };

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {MODES.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={mode === tab.id}
            onClick={() => setMode(tab.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              mode === tab.id
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={navigation.prev}
          aria-label="Previous"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          ←
        </button>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{navigation.title}</h2>
        <button
          type="button"
          onClick={navigation.next}
          aria-label="Next"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          →
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Loading calendar…</p>}

      {!loading && !error && mode === "month" && (
        <>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_HEADERS.map((day) => (
              <div
                key={day}
                className="text-center text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="space-y-1">
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
          className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
          role="dialog"
          aria-label={`Events on ${selectedDay.isoDate}`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {selectedDay.isoDate}
            </h3>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
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
