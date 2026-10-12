import type { ComponentType, SVGProps } from "react";
import type { EventPriority } from "../../core/eventTypes";
import {
  ArrowDownIcon,
  ExclamationTriangleIcon,
  FireIcon,
} from "@heroicons/react/24/solid";

/** Icon tint per priority — solid heroicons colored by urgency. */
const ICON_COLORS: Record<EventPriority, string> = {
  critical: "text-red-500 dark:text-red-400",
  medium: "text-amber-500 dark:text-amber-400",
  low: "text-sky-500 dark:text-sky-400",
};

/**
 * The icon per priority: fire (act now), warning triangle (steady caution),
 * down arrow (low urgency). Solid heroicons stay crisp at small sizes, so
 * each priority reads by shape as well as color — in both light and dark
 * mode.
 */
const PRIORITY_ICONS: Record<
  EventPriority,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  critical: FireIcon,
  medium: ExclamationTriangleIcon,
  low: ArrowDownIcon,
};

/** Props for the priority dot. */
export interface PriorityDotProps {
  /** The event priority driving the icon and its tint. */
  priority: EventPriority;
  /** Visual size of the icon. */
  size?: "sm" | "md" | "lg";
  /** Extra classes (e.g. layout). */
  className?: string;
}

const SIZES: Record<NonNullable<PriorityDotProps["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

/**
 * A priority icon, nothing more.
 *
 * Just the solid priority glyph — fire for critical, warning triangle for
 * medium, down arrow for low — tinted by urgency, no bubble or background.
 * Priorities are distinguishable by shape as well as color in both light
 * and dark mode. Purely presentational.
 */
export function PriorityDot({
  priority,
  size = "md",
  className = "",
}: PriorityDotProps) {
  const color = ICON_COLORS[priority] ?? ICON_COLORS.medium;
  const Icon = PRIORITY_ICONS[priority] ?? PRIORITY_ICONS.medium;
  return (
    <Icon
      aria-hidden
      data-priority={priority}
      className={`shrink-0 ${color} ${SIZES[size]} ${className}`}
    />
  );
}
