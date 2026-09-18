import type { EventPriority } from "../../core/eventTypes";
import { priorityStyle } from "../../core/timeline";

/** Gradient stops per priority for the glossy dot. */
const DOT_GRADIENTS: Record<EventPriority, string> = {
  critical: "from-rose-400 via-red-500 to-red-700",
  medium: "from-amber-300 via-amber-400 to-orange-600",
  low: "from-sky-300 via-sky-400 to-indigo-500",
};

/** Props for the priority dot. */
export interface PriorityDotProps {
  /** The event priority driving the gradient. */
  priority: EventPriority;
  /** Visual size of the dot. */
  size?: "sm" | "md" | "lg";
  /** Extra classes (e.g. layout). */
  className?: string;
}

const SIZES: Record<NonNullable<PriorityDotProps["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

/**
 * A stylish gradient priority dot.
 *
 * Replaces the old bordered circle with a `!`/`•`/`·` glyph: a saturated
 * radial-looking gradient orb with a glossy top-left highlight, a soft
 * colored shadow and a translucent ring so it reads as a jewel-like status
 * light in both light and dark mode. Purely presentational — the gradient
 * is derived from the priority via `DOT_GRADIENTS` (kept in sync with
 * `priorityStyle` in `src/core/timeline`).
 */
export function PriorityDot({ priority, size = "md", className = "" }: PriorityDotProps) {
  const gradient = DOT_GRADIENTS[priority] ?? DOT_GRADIENTS.medium;
  // Touch the core mapping so the two stay in sync (unused at runtime).
  void priorityStyle(priority);
  return (
    <span
      aria-hidden
      data-priority={priority}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradient} ${SIZES[size]} ring-1 ring-white/50 ring-inset shadow-md dark:ring-white/20 ${priority === "critical" ? "shadow-red-500/40" : priority === "medium" ? "shadow-amber-500/40" : "shadow-sky-500/40"} ${className}`}
    >
      {/* Glossy highlight: a soft white blob offset to the top-left. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-[18%] top-[14%] h-[38%] w-[38%] rounded-full bg-white/60 blur-[1px]"
      />
      {/* Inner depth: subtle bottom shade for a spherical feel. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-t from-black/20 via-transparent to-white/10"
      />
    </span>
  );
}
