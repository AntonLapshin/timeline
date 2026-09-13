import { useCalendar } from "../viewModels/useCalendar";
import { toOccurrenceRow, type CalendarDay } from "../../core/calendar";

/** Weekday column headers (Sunday-first, matching the grid). */
const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
          ? "border-slate-200 bg-white hover:bg-slate-50"
          : "border-transparent bg-slate-50 text-slate-300"
      }`}
    >
      <span className={`font-medium ${day.inMonth ? "text-slate-700" : ""}`}>
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
export function OccurrenceRowView({ day }: { day: CalendarDay }) {
  return (
    <ul className="space-y-2">
      {day.occurrences.map((o) => {
        const row = toOccurrenceRow(o);
        return (
          <li
            key={`${o.event_id}-${o.start_at}`}
            className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
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
                  {row.occurrence.title}
                </span>
                {row.recurrenceBadge && (
                  <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">
                    ↻ {row.recurrenceBadge}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <span>{row.timeLabel}</span>
                {row.nextOccurrenceLabel && (
                  <span className="text-slate-400">{row.nextOccurrenceLabel}</span>
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

/**
 * The Calendar view (month grid + day drawer).
 *
 * A thin, dumb view: it calls the `useCalendar` view model for state and
 * renders the month navigation header, the weekday header, the clickable day
 * cells, and the day drawer for the selected day. No business logic lives
 * here.
 */
export function CalendarView() {
  const {
    grid,
    monthLabel: label,
    selectedDay,
    loading,
    error,
    prevMonth,
    nextMonth,
    selectDay,
    closeDrawer,
  } = useCalendar();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Previous month"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ←
        </button>
        <h2 className="text-lg font-semibold text-slate-900">{label}</h2>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Next month"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          →
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading calendar…</p>}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_HEADERS.map((day) => (
              <div
                key={day}
                className="text-center text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {grid.weeks.map((week) => (
              <div key={week.key} className="grid grid-cols-7 gap-1">
                {week.days.map((day) => (
                  <DayCell key={day.isoDate} day={day} onSelect={selectDay} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {selectedDay && (
        <div
          className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm"
          role="dialog"
          aria-label={`Events on ${selectedDay.isoDate}`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">
              {selectedDay.isoDate}
            </h3>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
            >
              ✕
            </button>
          </div>
          {selectedDay.count === 0 ? (
            <p className="text-sm text-slate-500">No events this day.</p>
          ) : (
            <OccurrenceRowView day={selectedDay} />
          )}
        </div>
      )}
    </div>
  );
}
