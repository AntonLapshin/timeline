import type { EventPriority } from "../../core/eventTypes";

/** Gradient stops per priority for the glossy orb. */
const DOT_GRADIENTS: Record<EventPriority, string> = {
  critical: "from-rose-400 via-red-500 to-red-700",
  medium: "from-amber-300 via-amber-400 to-orange-600",
  low: "from-sky-300 via-sky-400 to-indigo-500",
};

/** Soft colored glow per priority. */
const DOT_GLOWS: Record<EventPriority, string> = {
  critical: "shadow-red-500/45",
  medium: "shadow-amber-500/45",
  low: "shadow-sky-500/45",
};

/**
 * The urgency glyph per priority: `!` (act now), `=` (steady),
 * `↓` (low urgency). Rendered in bold white over the orb so each priority
 * reads as an icon, not just a colored bubble.
 */
const DOT_GLYPHS: Record<EventPriority, string> = {
  critical: "!",
  medium: "=",
  low: "↓",
};

/** Props for the priority dot. */
export interface PriorityDotProps {
  /** The event priority driving the gradient and glyph. */
  priority: EventPriority;
  /** Visual size of the dot. */
  size?: "sm" | "md" | "lg";
  /**
   * Render the urgency glyph. Defaults to true; pass false for tiny
   * renderings (e.g. 10px dots) where the glyph would be unreadable.
   */
  glyph?: boolean;
  /** Extra classes (e.g. layout). */
  className?: string;
}

const SIZES: Record<NonNullable<PriorityDotProps["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

const GLYPH_SIZES: Record<NonNullable<PriorityDotProps["size"]>, string> = {
  sm: "text-[9px]",
  md: "text-xs",
  lg: "text-sm",
};

/**
 * A stylish gradient priority icon.
 *
 * A saturated jewel-like orb (diagonal gradient, top-left gloss, bottom
 * shade, translucent inner ring, soft colored glow) with a bold white
 * urgency glyph per priority (`!` / `=` / `↓`) so critical, medium and low
 * are distinguishable by shape as well as color — in both light and dark
 * mode. Purely presentational.
 */
export function PriorityDot({
  priority,
  size = "md",
  glyph = true,
  className = "",
}: PriorityDotProps) {
  const gradient = DOT_GRADIENTS[priority] ?? DOT_GRADIENTS.medium;
  const glow = DOT_GLOWS[priority] ?? DOT_GLOWS.medium;
  const symbol = DOT_GLYPHS[priority] ?? DOT_GLYPHS.medium;
  return (
    <span
      aria-hidden
      data-priority={priority}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradient} ${SIZES[size]} shadow-md ring-1 ring-inset ring-white/60 dark:ring-white/25 ${glow} ${className}`}
    >
      {/* Glossy highlight: a soft white sheen tucked into the top-left. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-[16%] top-[9%] h-[32%] w-[44%] -rotate-12 rounded-full bg-white/50 blur-[1px]"
      />
      {/* Inner depth: subtle bottom shade for a spherical feel. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-t from-black/25 via-transparent to-white/10"
      />
      {/* Urgency glyph, centered over the orb. */}
      {glyph && (
        <span
          aria-hidden
          className={`relative font-extrabold leading-none text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.4)] ${GLYPH_SIZES[size]}`}
        >
          {symbol}
        </span>
      )}
    </span>
  );
}
