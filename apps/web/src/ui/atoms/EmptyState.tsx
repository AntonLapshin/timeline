import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** Optional decorative icon, shown in a tinted circle. */
  icon?: ReactNode;
  /** Headline. */
  title: ReactNode;
  /** Supporting text. */
  description?: ReactNode;
  /** Primary action (e.g. a `Button`). */
  action?: ReactNode;
  /** Extra classes appended after the card classes. */
  className?: string;
}

/**
 * Centered "nothing here yet" placeholder: dashed card, optional icon in a
 * tinted circle, semibold title, muted description, action slot.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`card border-dashed p-8 text-center ${className}`.trim()}>
      {icon && (
        <div
          aria-hidden="true"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-400/10 dark:text-brand-300"
        >
          <span className="inline-flex [&>svg]:h-6 [&>svg]:w-6">{icon}</span>
        </div>
      )}
      <p className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
