import type { RefObject } from "react";
import type { EventFilter } from "../../core/searchFilter";
import type { EventPriority } from "../../core/eventTypes";

/** The filterable priority options in display order. */
const PRIORITY_OPTIONS: Array<{ value: EventPriority; label: string }> = [
  { value: "critical", label: "Critical" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** Props for the search/filter bar. */
export interface SearchFilterBarProps {
  /** The current filter. */
  filter: EventFilter;
  /** The distinct tags available to filter by. */
  tags: string[];
  /** The distinct months (YYYY-MM) available to filter by. */
  months: string[];
  /** Ref attached to the text input (so the `/` shortcut can focus it). */
  inputRef?: RefObject<HTMLInputElement>;
  /** Called when the free-text query changes. */
  onTextChange: (text: string) => void;
  /** Called when the priority filter changes (null clears). */
  onPriorityChange: (priority: EventPriority | null) => void;
  /** Called when the tag filter changes (null clears). */
  onTagChange: (tag: string | null) => void;
  /** Called when the month filter changes (null clears). */
  onMonthChange: (month: string | null) => void;
  /** Called to clear all filters. */
  onClear: () => void;
}

/**
 * The app-wide search/filter bar (issue #46).
 *
 * A thin, dumb component: it renders the text search box plus priority/tag/month
 * filter selects and a clear button, and forwards user input to the callback
 * props. Esc in the text box clears the filters and blurs. No business logic —
 * all matching/filtering lives in `src/core`.
 */
export function SearchFilterBar({
  filter,
  tags,
  months,
  inputRef,
  onTextChange,
  onPriorityChange,
  onTagChange,
  onMonthChange,
  onClear,
}: SearchFilterBarProps) {
  const hasOptions = tags.length > 0 || months.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="search"
        value={filter.text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClear();
            e.currentTarget.blur();
          }
        }}
        placeholder="Search events…"
        aria-label="Search events"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 sm:w-56"
      />
      <select
        value={filter.priority ?? ""}
        onChange={(e) =>
          onPriorityChange(
            e.target.value === "" ? null : (e.target.value as EventPriority),
          )
        }
        aria-label="Filter by priority"
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      >
        <option value="">Priority</option>
        {PRIORITY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        value={filter.tag ?? ""}
        onChange={(e) => onTagChange(e.target.value === "" ? null : e.target.value)}
        aria-label="Filter by tag"
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      >
        <option value="">Tag</option>
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
      <select
        value={filter.month ?? ""}
        onChange={(e) =>
          onMonthChange(e.target.value === "" ? null : e.target.value)
        }
        aria-label="Filter by month"
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      >
        <option value="">Month</option>
        {months.map((month) => (
          <option key={month} value={month}>
            {month}
          </option>
        ))}
      </select>
      {hasOptions && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          Clear
        </button>
      )}
    </div>
  );
}
