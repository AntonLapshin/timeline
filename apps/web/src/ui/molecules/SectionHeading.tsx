import type { ReactNode } from "react";

export interface SectionHeadingProps {
  /** Small uppercase kicker above the title. */
  eyebrow?: ReactNode;
  /** The heading text. */
  title: ReactNode;
  /** Optional supporting copy below the title. */
  description?: ReactNode;
  /** Optional trailing slot (actions, links). */
  action?: ReactNode;
  /** Extra classes for the wrapper. */
  className?: string;
  /** Heading level. Defaults to `"h2"`. */
  titleAs?: "h2" | "h3";
}

/**
 * A section header: eyebrow kicker, bold display title, optional
 * description, and an optional trailing action slot.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className = "",
  titleAs = "h2",
}: SectionHeadingProps) {
  const TitleTag = titleAs;
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-400">
            {eyebrow}
          </p>
        )}
        <TitleTag className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {title}
        </TitleTag>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
