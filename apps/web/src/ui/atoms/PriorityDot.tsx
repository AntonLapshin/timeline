import type { ComponentType, SVGProps } from "react";
import type { EventPriority } from "../../core/eventTypes";
import {
  ArrowDownIcon,
  ExclamationTriangleIcon,
  FireIcon,
} from "@heroicons/react/24/solid";

/** Gradient stops per priority for the glossy orb. */
const DOT_GRADIENTS: Record<EventPriority, string> = {
  critical: "from-rose-500 via-red-600 to-red-800",
  medium: "from-amber-400 via-orange-500 to-orange-700",
  low: "from-sky-400 via-blue-500 to-blue-700",
};

/** Soft colored glow per priority. */
const DOT_GLOWS: Record<EventPriority, string> = {
  critical: "shadow-red-500/45",
  medium: "shadow-orange-500/45",
  low: "shadow-blue-500/45",
};

/**
 * The icon per priority: fire (act now), warning triangle (steady caution),
 * down arrow (low urgency). Solid heroicons stay crisp at small sizes, so
 * each priority reads by shape as well as color — in both light and dark
 * mode.
 */
const DOT_ICONS: Record<
  EventPriority,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  critical: FireIcon,
  medium: ExclamationTriangleIcon,
  low: ArrowDownIcon,
};

/** Props for the priority dot. */
export interface PriorityDotProps {
  /** The event priority driving the gradient and icon. */
  priority: EventPriority;
  /** Visual size of the dot. */
  size?: "sm" | "md" | "lg";
  /**
   * Render the priority icon. Defaults to true; pass false for tiny
   * renderings (e.g. 10px dots) where the icon would be unreadable.
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

const ICON_SIZES: Record<NonNullable<PriorityDotProps["size"]>, string> = {
  sm: "h-2.5 w-2.5",
  md: "h-3.5 w-3.5",
  lg: "h-[18px] w-[18px]",
};

/**
 * A stylish gradient priority icon.
 *
 * A saturated jewel-like orb (diagonal gradient, top-left gloss, bottom
 * shade, translucent inner ring, soft colored glow) with a solid white
 * priority icon — fire for critical, warning triangle for medium, down
 * arrow for low — so critical, medium and low are distinguishable by shape
 * as well as color in both light and dark mode. Purely presentational.
 */
export function PriorityDot({
  priority,
  size = "md",
  glyph = true,
  className = "",
}: PriorityDotProps) {
  const gradient = DOT_GRADIENTS[priority] ?? DOT_GRADIENTS.medium;
  const glow = DOT_GLOWS[priority] ?? DOT_GLOWS.medium;
  const Icon = DOT_ICONS[priority] ?? DOT_ICONS.medium;
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
      {/* Priority icon, centered over the orb. */}
      {glyph && (
        <Icon
          aria-hidden
          className={`relative text-white drop-shadow-[0_1px_1px_rgb(0_0_0/0.45)] ${ICON_SIZES[size]}`}
        />
      )}
    </span>
  );
}
