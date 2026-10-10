import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";

/**
 * The active (selected) treatment shared with the Recurrence option cards
 * in the event wizard: indigo gradient, white text — but deliberately
 * without `shadow-md` (segment actives are flat inside their track).
 *
 * Note: SegmentedControl itself now renders its active state with a sliding
 * indicator; this export is kept (with its original value) for the wizard
 * option cards that import it directly.
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
 * The active segment is shown with a sliding brand-gradient indicator that
 * measures and tracks the active button (`useLayoutEffect` + window resize).
 * Roving tabindex: the active button is tabbable, the rest are not;
 * ArrowLeft/Right (and Home/End) move focus and select in one step.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "",
}: SegmentedControlProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<T, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({ left: 0, width: 0, visible: false });

  const measure = useCallback(() => {
    const track = trackRef.current;
    const activeButton = buttonRefs.current.get(value);
    if (!track || !activeButton) return;
    const trackRect = track.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setIndicator({
      left: buttonRect.left - trackRect.left,
      width: buttonRect.width,
      visible: true,
    });
  }, [value]);

  // Re-measure after render (value/options change) and on window resize.
  useLayoutEffect(() => {
    measure();
  }, [measure, options]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const select = (id: T) => {
    onChange(id);
    buttonRefs.current.get(id)?.focus();
  };

  const onSegmentKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (index + 1) % options.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (index - 1 + options.length) % options.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = options.length - 1;
    }
    if (next !== null) {
      e.preventDefault();
      select(options[next].id);
    }
  };

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label={label}
      className={`relative flex gap-1 rounded-2xl border border-slate-200/70 bg-slate-100/70 p-1 dark:border-slate-700/50 dark:bg-ink-800/70 ${className}`}
    >
      {indicator.visible && (
        <span
          aria-hidden
          style={{ left: indicator.left, width: indicator.width }}
          className="pointer-events-none absolute bottom-1 top-1 rounded-xl bg-gradient-to-b from-brand-500 to-brand-700 shadow-md shadow-brand-600/25 transition-[left,width] duration-200 ease-out dark:from-brand-400 dark:to-brand-600"
        />
      )}
      {options.map((opt, index) => {
        const active = opt.id === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            ref={(el) => {
              if (el) {
                buttonRefs.current.set(opt.id, el);
              } else {
                buttonRefs.current.delete(opt.id);
              }
            }}
            type="button"
            aria-pressed={active}
            tabIndex={active ? 0 : -1}
            onClick={() => select(opt.id)}
            onKeyDown={(e) => onSegmentKeyDown(e, index)}
            className={`relative z-10 flex h-auto min-h-8 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium leading-none transition-colors duration-200 ${
              active
                ? "text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
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
