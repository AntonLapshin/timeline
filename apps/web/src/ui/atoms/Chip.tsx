import type { ReactNode } from "react";

/** Chip color treatments. */
export type ChipTone = "brand" | "violet" | "slate" | "red" | "green" | "amber";

const TONE_CLASSES: Record<ChipTone, string> = {
  brand:
    "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-400/20 dark:bg-brand-400/10 dark:text-brand-300",
  violet:
    "border-violet-200 bg-violet-50/80 text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300",
  slate:
    "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600/50 dark:bg-slate-700/20 dark:text-slate-300",
  red:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300",
  green:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  amber:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300",
};

export interface ChipProps {
  /** Color treatment. Defaults to `"slate"`. */
  tone?: ChipTone;
  /** Optional leading icon (decorative). */
  icon?: ReactNode;
  /** Chip content. */
  children: ReactNode;
  /** Extra classes appended after the chip classes. */
  className?: string;
}

/**
 * Small pill badge (status, recurrence, counts, …).
 *
 * Composes the shared `.chip` base with a per-tone border/background/text
 * treatment for light and dark mode. The `icon` is decorative.
 */
export function Chip({ tone = "slate", icon, children, className = "" }: ChipProps) {
  return (
    <span className={`chip ${TONE_CLASSES[tone]} ${className}`.trim()}>
      {icon && (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
