import type { KeyboardEvent, RefObject } from "react";
import type { EventFilter } from "../../core/searchFilter";
import type { EventPriority } from "../../core/eventTypes";
import { Dropdown } from "../molecules/Dropdown";
import { SearchField } from "../molecules/SearchField";
import { Button } from "../atoms/Button";

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
 * filter dropdowns and a clear button, and forwards user input to the callback
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

  // `SearchField` owns Escape for its own clear-text behavior, so the
  // bar-wide "Esc clears all filters and blurs" contract lives on this
  // wrapper (bubbled from the input), keeping the shortcut working even
  // when no `inputRef` was provided.
  const handleSearchKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      onClear();
      e.currentTarget.querySelector("input")?.blur();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-48 flex-1" onKeyDown={handleSearchKeyDown}>
        <SearchField
          inputRef={inputRef}
          value={filter.text}
          onChange={onTextChange}
          placeholder="Search events…"
          label="Search events"
        />
      </div>
      <Dropdown
        label="Filter by priority"
        placeholder="Priority"
        value={filter.priority}
        options={PRIORITY_OPTIONS}
        onChange={(v) => onPriorityChange(v === null ? null : (v as EventPriority))}
      />
      <Dropdown
        label="Filter by tag"
        placeholder="Tag"
        value={filter.tag}
        options={tags.map((tag) => ({ value: tag, label: tag }))}
        onChange={onTagChange}
      />
      <Dropdown
        label="Filter by month"
        placeholder="Month"
        value={filter.month}
        options={months.map((month) => ({ value: month, label: month }))}
        onChange={onMonthChange}
      />
      {hasOptions && (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
