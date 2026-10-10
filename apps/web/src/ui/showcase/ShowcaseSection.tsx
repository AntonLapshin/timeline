import type { ReactNode } from "react";
import { SectionHeading } from "../molecules/SectionHeading";

/**
 * A labeled gallery section in the Showcase page.
 *
 * Thin, presentational container: renders the component name as a
 * `SectionHeading` (h2, so the gallery's section titles stay real headings)
 * with an optional caption, and the gallery content inside a bordered card.
 * No business logic.
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
    <section className="card scroll-mt-28 p-4 sm:p-5">
      <SectionHeading title={title} description={caption} />
      <div className="mt-4 space-y-4">{children}</div>
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
