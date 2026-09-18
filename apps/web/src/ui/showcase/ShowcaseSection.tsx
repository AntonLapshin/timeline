import type { ReactNode } from "react";

/**
 * A labeled gallery section in the Showcase page.
 *
 * Thin, presentational container: renders a section title + optional caption
 * and the gallery content inside a bordered card. No business logic.
 */
export function ShowcaseSection({
  title,
  caption,
  children,
}: {
  /** The component name shown as the section heading. */
  title: string;
  /** Optional one-line description of the states demonstrated. */
  caption?: string;
  /** The gallery content (one or more state previews). */
  children: ReactNode;
}) {
  return (
    <section className="card p-4">
      <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      {caption && (
        <p className="mt-0.5 text-xs leading-4 text-slate-500 dark:text-slate-400">
          {caption}
        </p>
      )}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/**
 * A single labeled state preview within a gallery section.
 *
 * Renders a small state label (e.g. "Populated", "Empty", "Error", "Dark") and
 * the actual component preview beneath it. Thin and presentational.
 */
export function ShowcaseState({
  label,
  children,
}: {
  /** The state name (e.g. "Populated"). */
  label: string;
  /** The component rendered in this state. */
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}
