import type { CSSProperties, ReactNode } from "react";
import type { EventPriority } from "../../core/eventTypes";
import { PriorityDot } from "../atoms/PriorityDot";

export interface EventCardProps {
  /** The event title. */
  title: ReactNode;
  /** Optional secondary text (clamped to two lines). */
  description?: ReactNode;
  /** Primary time display, e.g. "Sat 10:00–11:30". */
  timeLabel: ReactNode;
  /** Optional relative-time chip, e.g. "in 2h". */
  relativeLabel?: ReactNode;
  /** Optional recurrence badge (render a Chip with tone="violet"). */
  recurrenceBadge?: ReactNode;
  /** Optional tag label shown at the trailing edge. */
  tagLabel?: ReactNode;
  /** Extra classes for the tag chip. */
  tagClassName?: string;
  /** Drives the stripe, dot, and icon-tint colors. */
  priority: EventPriority;
  /**
   * Click handler. Optional for future non-interactive uses — the card is
   * always rendered as a `<button>` so the hit target stays consistent.
   */
  onClick?: () => void;
  /** Inline styles (e.g. `--enter-delay` for staggered entrances). */
  style?: CSSProperties;
  /** Test hook. */
  testId?: string;
  /** Extra classes for the card. */
  className?: string;
}

/** Priority stripe gradients (critical → red, medium → amber, low → brand). */
const STRIPE_CLASSES: Record<EventPriority, string> = {
  critical: "from-rose-400 to-red-600",
  medium: "from-amber-300 to-orange-500",
  low: "from-sky-300 to-brand-500",
};

/** Tinted icon-square backgrounds behind the priority dot. */
const TINT_CLASSES: Record<EventPriority, string> = {
  critical: "bg-red-500/10 dark:bg-red-400/15",
  medium: "bg-amber-500/10 dark:bg-amber-400/15",
  low: "bg-sky-500/10 dark:bg-sky-400/15",
};

/**
 * The timeline/occurrence card.
 *
 * A priority-striped interactive card: dot-in-a-tint, truncated title with
 * an optional recurrence badge, clamped description, a time meta row with
 * an optional relative-time chip, and an optional trailing tag chip.
 * `flex-wrap` / `min-w-0` keep everything inside 360px viewports.
 */
export function EventCard({
  title,
  description,
  timeLabel,
  relativeLabel,
  recurrenceBadge,
  tagLabel,
  tagClassName = "",
  priority,
  onClick,
  style,
  testId,
  className = "",
}: EventCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      data-testid={testId}
      className={`card-interactive group relative w-full overflow-hidden p-4 text-left ${className}`}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-0 h-full w-1 bg-gradient-to-b ${STRIPE_CLASSES[priority]}`}
      />
      <div className="flex items-start gap-3 pl-1.5">
        <span
          aria-hidden
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TINT_CLASSES[priority]}`}
        >
          <PriorityDot priority={priority} size="md" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </span>
            {recurrenceBadge}
          </div>
          {description && (
            <div className="mt-1 line-clamp-2 text-sm leading-snug text-slate-500 dark:text-slate-400">
              {description}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
            <span className="tabular-nums text-slate-500 dark:text-slate-400">{timeLabel}</span>
            {relativeLabel && (
              <span className="chip border-slate-200/80 bg-slate-100 text-slate-600 dark:border-slate-600/60 dark:bg-white/5 dark:text-slate-300">
                {relativeLabel}
              </span>
            )}
            {tagLabel && (
              <span
                className={`chip border-slate-200/80 bg-slate-100 text-slate-600 dark:border-slate-600/60 dark:bg-white/5 dark:text-slate-300 ${tagClassName}`}
              >
                {tagLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
