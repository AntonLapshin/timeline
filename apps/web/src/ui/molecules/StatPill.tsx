import type { ReactNode } from "react";

/** Color treatments for the pill. */
export type StatPillTone = "brand" | "slate" | "red" | "green" | "amber";

export interface StatPillProps {
  /** Optional leading icon (rendered aria-hidden). */
  icon?: ReactNode;
  /** The muted label, e.g. "events". */
  label: string;
  /** The semibold value, e.g. "12". */
  value: ReactNode;
  /** Color treatment. Defaults to `"slate"`. */
  tone?: StatPillTone;
  /** Extra classes. */
  className?: string;
}

const TONE_CLASSES: Record<StatPillTone, string> = {
  brand:
    "border-brand-200/80 bg-brand-50 text-brand-700 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-brand-300",
  slate:
    "border-slate-200/80 bg-slate-100 text-slate-600 dark:border-slate-600/60 dark:bg-white/5 dark:text-slate-300",
  red: "border-red-200/80 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300",
  green:
    "border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  amber:
    "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300",
};

/**
 * A compact statistic pill: icon + semibold value + muted label.
 *
 * Renders as a tone-styled `.chip` span. The content is plain text, so no
 * extra `aria-label` is needed.
 */
export function StatPill({ icon, label, value, tone = "slate", className = "" }: StatPillProps) {
  return (
    <span className={`chip gap-1.5 ${TONE_CLASSES[tone]} ${className}`}>
      {icon && (
        <span aria-hidden className="inline-flex">
          {icon}
        </span>
      )}
      <span className="font-bold tabular-nums">{value}</span>
      <span className="font-medium opacity-75">{label}</span>
    </span>
  );
}
