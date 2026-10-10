import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useCalendar, type CalendarMode } from "../viewModels/useCalendar";
import {
  dayDotClasses,
  daySlots,
  toOccurrenceRow,
  weekGrid,
  type AgendaRow,
  type CalendarDay,
} from "../../core/calendar";
import { toLocalDate } from "../../core/dateFmt";
import { isFiltering, type EventFilter } from "../../core/searchFilter";
import type { EventOccurrence } from "../../core/eventTypes";
import { PriorityDot } from "../atoms/PriorityDot";
import { Chip } from "../atoms/Chip";
import { Skeleton } from "../atoms/Skeleton";
import { Alert } from "../atoms/Alert";
import { SegmentedControl } from "../molecules/SegmentedControl";
import { Button } from "../atoms/Button";
import { EventCard } from "../molecules/EventCard";
import { SlideOver } from "../molecules/SlideOver";
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

/** Weekday column headers (Sunday-first, matching the grid). */
const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The three Calendar sub-mode tabs. */
const MODES: Array<{ id: CalendarMode; label: string }> = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "agenda", label: "Agenda" },
];

/** `id` of the day-drawer heading (labels the slide-over dialog). */
const DAY_DRAWER_TITLE_ID = "calendar-day-drawer-title";

/**
 * A single day cell in the month grid.
 *
 * Dumb view: renders the day-of-month number and one dot per occurrence
 * (up to 3, colored by each occurrence's priority via `dayDotClasses`) passed
 * in from the view model's grid, and calls `onSelect` when clicked. No
 * business logic — all derivation lives in `src/core`.
 *
 * The cell takes part in the month grid's roving tabindex: exactly one day
 * is tabbable (`tabIndex={0}`); `dayIndex`/`onFocus` let the grid move and
 * sync the roving origin.
 */
export function DayCell({
  day,
  onSelect,
  tabIndex,
  dayIndex,
  onFocus,
  isToday,
  isSelected,
}: {
  day: CalendarDay;
  onSelect: (day: CalendarDay) => void;
  /** Roving-tabindex value: 0 for the keyboard-active day, -1 for the rest. */
  tabIndex: number;
  /** Flat index of the day in the month grid (keyboard-navigation hook). */
  dayIndex: number;
  /** Syncs the roving-tabindex origin when the day receives focus. */
  onFocus: () => void;
  /** Whether this day is today. */
  isToday: boolean;
  /** Whether this day is the currently selected (drawer-open) day. */
  isSelected: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      onFocus={onFocus}
      tabIndex={tabIndex}
      data-day-index={dayIndex}
      aria-current={isToday ? "date" : undefined}
      aria-label={`${day.isoDate}, ${day.count} event${day.count === 1 ? "" : "s"}`}
      className={`print-month-cell flex min-h-16 flex-col items-center justify-start rounded-2xl border p-1.5 text-sm leading-none transition-[transform,box-shadow,background-color,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-card ${
        isSelected
          ? "border-transparent bg-gradient-to-b from-brand-500 to-brand-700 text-white shadow-glow-sm"
          : day.inMonth
            ? "border-slate-200/80 bg-white shadow-sm hover:bg-slate-50 dark:border-slate-700/70 dark:bg-slate-800 dark:hover:bg-slate-700/80"
            : "border-transparent bg-slate-100/60 text-slate-300 dark:bg-slate-800/40 dark:text-slate-600"
      } ${isToday ? "font-bold ring-2 ring-brand-500" : ""}`}
    >
      <span
        className={`font-medium ${
          isSelected
            ? "text-white"
            : day.inMonth
              ? "text-slate-700 dark:text-slate-200"
              : ""
        }`}
      >
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
            <span
              className={`text-[10px] font-medium leading-none ${
                isSelected
                  ? "text-white/85"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              +{day.count - 3}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/**
 * The month grid with roving-tabindex keyboard navigation.
 *
 * One day is tabbable at a time; arrow keys move the active day (±1 / ±7)
 * and move DOM focus with it, Home/End jump to the edges of the week row,
 * and focusing a day by pointer syncs the roving origin so tabbing back in
 * lands on the last-focused day. Enter/Space activate the focused day via
 * the native button behavior — no extra handling needed.
 */
function MonthGrid({
  grid,
  onSelect,
  todayIso,
  selectedIso,
}: {
  grid: ReturnType<typeof useCalendar>["grid"];
  onSelect: (day: CalendarDay) => void;
  /** Today's local `YYYY-MM-DD` (drives the today highlight). */
  todayIso: string;
  /** The selected day's `YYYY-MM-DD`, if the drawer is open. */
  selectedIso: string | null;
}) {
  const days = useMemo(
    () => grid.weeks.flatMap((weekRow) => weekRow.days),
    [grid],
  );
  const defaultIndex = Math.max(
    0,
    days.findIndex((day) => day.isoDate === todayIso),
  );
  const [focusedIndex, setFocusedIndex] = useState(defaultIndex);

  // Reset the roving origin when the visible month changes.
  useEffect(() => {
    setFocusedIndex(defaultIndex);
  }, [defaultIndex]);

  const focusDay = (index: number) => {
    const clamped = Math.max(0, Math.min(days.length - 1, index));
    setFocusedIndex(clamped);
    document
      .querySelector<HTMLElement>(`[data-day-index="${clamped}"]`)
      ?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        focusDay(focusedIndex - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        focusDay(focusedIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusDay(focusedIndex - 7);
        break;
      case "ArrowDown":
        event.preventDefault();
        focusDay(focusedIndex + 7);
        break;
      case "Home":
        event.preventDefault();
        focusDay(focusedIndex - (focusedIndex % 7));
        break;
      case "End":
        event.preventDefault();
        focusDay(focusedIndex + (6 - (focusedIndex % 7)));
        break;
      default:
        break;
    }
  };

  return (
    <>
      <div className="grid grid-cols-7 gap-1 print-hidden">
        {WEEKDAY_HEADERS.map((day) => (
          <div
            key={day}
            className="text-center text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="space-y-1 print-month-grid" onKeyDown={handleKeyDown}>
        {grid.weeks.map((weekRow, weekIdx) => (
          <div key={weekRow.key} className="grid grid-cols-7 gap-1">
            {weekRow.days.map((day, dayIdx) => {
              const index = weekIdx * 7 + dayIdx;
              return (
                <DayCell
                  key={day.isoDate}
                  day={day}
                  onSelect={onSelect}
                  tabIndex={index === focusedIndex ? 0 : -1}
                  dayIndex={index}
                  onFocus={() => setFocusedIndex(index)}
                  isToday={day.isoDate === todayIso}
                  isSelected={day.isoDate === selectedIso}
                />
              );
            })}
          </div>
        ))}
      </div>
    </>
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
          <li key={`${o.event_id}-${o.start_at}`} className="list-none">
            <EventCard
              title={row.occurrence.title}
              description={row.nextOccurrenceLabel ?? undefined}
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
                row.occurrence.tag ? (
                  <>
                    {row.tagIcon} {row.occurrence.tag}
                  </>
                ) : undefined
              }
              tagClassName={row.tagColor}
              priority={row.occurrence.priority}
              onClick={onEventClick ? () => onEventClick(o) : undefined}
            />
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
    <li className="list-none">
      <EventCard
        title={row.occurrence.title}
        description={row.dateLabel}
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
          row.occurrence.tag ? (
            <>
              {row.tagIcon} {row.occurrence.tag}
            </>
          ) : undefined
        }
        tagClassName={row.tagColor}
        priority={row.occurrence.priority}
        onClick={onEventClick ? () => onEventClick(row.occurrence) : undefined}
      />
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

  // Local YYYY-MM-DD for the today highlight (matches the view model's
  // `toLocalDate`-based `isoDate` values).
  const todayIso = toLocalDate(new Date());

  return (
    <div className="space-y-4">
      <SegmentedControl<CalendarMode>
        label="Calendar mode"
        value={mode}
        onChange={setMode}
        options={MODES}
        className="print-hidden"
      />

      <div className="flex items-center justify-between print-hidden">
        <Button
          variant="ghost"
          square
          onClick={navigation.prev}
          aria-label="Previous"
        >
          <ChevronLeftIcon aria-hidden className="h-4 w-4" />
        </Button>
        <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{navigation.title}</h2>
        <Button
          variant="ghost"
          square
          onClick={navigation.next}
          aria-label="Next"
        >
          <ChevronRightIcon aria-hidden className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <Alert tone="error" title={error}>
          <Button variant="ghost" size="sm" onClick={retry} className="mt-1">
            Retry
          </Button>
        </Alert>
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
              <Skeleton key={day} className="h-3" />
            ))}
          </div>
          <div className="space-y-1">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, j) => (
                  <Skeleton key={j} className="h-16" />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && mode === "month" && (
        <MonthGrid
          grid={grid}
          onSelect={selectDay}
          todayIso={todayIso}
          selectedIso={selectedDay?.isoDate ?? null}
        />
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
        <div className="print-hidden">
          <SlideOver
            open
            onClose={closeDrawer}
            labelledBy={DAY_DRAWER_TITLE_ID}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2
                id={DAY_DRAWER_TITLE_ID}
                className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100"
              >
                Events on {selectedDay.isoDate}
              </h2>
              <Button
                variant="ghost"
                square
                onClick={closeDrawer}
                aria-label="Close"
              >
                <XMarkIcon aria-hidden className="h-4 w-4" />
              </Button>
            </div>
            {selectedDay.count === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No events this day.</p>
            ) : (
              <OccurrenceRowView day={selectedDay} onEventClick={onEventClick} />
            )}
          </SlideOver>
        </div>
      )}
    </div>
  );
}
