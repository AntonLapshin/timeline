import type { ComponentType } from "react";

/**
 * The active (selected) treatment shared with the Recurrence option cards
 * in the event wizard: indigo gradient, white text — but deliberately
 * without `shadow-md` (segment actives are flat inside their track).
 */
export const SEGMENT_ACTIVE_CLASSES =
  "border-indigo-500 bg-gradient-to-b from-indigo-500 to-indigo-700 text-white dark:border-indigo-400 dark:from-indigo-500 dark:to-indigo-600";

/** A single segment option. */
export interface SegmentOption<T extends string> {
  /** The option value. */
  id: T;
  /** The visible label. */
  label: string;
  /** Optional heroicon rendered before the label (inherits the item color). */
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible label for the group. */
  label: string;
  /** The available segments. */
  options: Array<SegmentOption<T>>;
  /** The currently active value. */
  value: T;
  /** Called when the user picks a segment. */
  onChange: (value: T) => void;
  /** Extra classes for the track. */
  className?: string;
}

/**
 * Shared segment control (Calendar Month/Week/Agenda, Timeline/Calendar).
 *
 * The active item reuses the Recurrence active color (indigo gradient) with
 * no shadow, and any active icon inherits the white foreground.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex gap-1 rounded-xl border border-slate-200/70 bg-slate-100/70 p-1 dark:border-slate-700/70 dark:bg-slate-800/70 ${className}`}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={`flex h-auto min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium leading-none transition-colors ${
              active
                ? SEGMENT_ACTIVE_CLASSES
                : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {Icon && <Icon aria-hidden className="h-4 w-4 shrink-0" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
