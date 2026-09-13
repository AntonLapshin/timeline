import type { ReactNode } from "react";

/** The available top-level views. */
export type AppView = "timeline" | "calendar";

/** Props for the app shell. */
export interface AppShellProps {
  /** The currently active view. */
  view: AppView;
  /** Called when the user switches views. */
  onViewChange: (view: AppView) => void;
  /** The active view's content. */
  children: ReactNode;
  /** Optional summary bar content rendered in the header slot. */
  summarySlot?: ReactNode;
  /** Optional search/filter bar content rendered in the header slot. */
  searchSlot?: ReactNode;
  /** Optional smart-input box content rendered in the header slot. */
  smartInputSlot?: ReactNode;
  /** Optional header actions (e.g. a New-event button). */
  actions?: ReactNode;
  /** Optional theme-toggle control rendered in the header. */
  themeToggleSlot?: ReactNode;
}

/**
 * The top-level app shell (issue #21).
 *
 * Provides the no-login localhost layout: a header that hosts the summary-bar
 * slot (wired in a later issue), a view switcher (Timeline / Calendar), and the
 * active view's content. Dumb component — it renders props and calls the
 * `onViewChange` callback; no business logic.
 */
export function AppShell({
  view,
  onViewChange,
  children,
  summarySlot,
  searchSlot,
  smartInputSlot,
  actions,
  themeToggleSlot,
}: AppShellProps) {
  const tabs: Array<{ id: AppView; label: string }> = [
    { id: "timeline", label: "Timeline" },
    { id: "calendar", label: "Calendar" },
  ];

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Timeline</h1>
          <div className="flex items-center gap-2">
            {themeToggleSlot}
            <nav className="flex flex-wrap gap-1" aria-label="Views">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={view === tab.id}
                  onClick={() => onViewChange(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    view === tab.id
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
              {actions && (
                <div className="ml-2 border-l border-slate-200 pl-2 dark:border-slate-600">
                  {actions}
                </div>
              )}
            </nav>
          </div>
        </div>
        {searchSlot && (
          <div className="mx-auto max-w-3xl px-4 pb-3">{searchSlot}</div>
        )}
        {smartInputSlot && (
          <div className="mx-auto max-w-3xl px-4 pb-3">{smartInputSlot}</div>
        )}
        {summarySlot && (
          <div className="mx-auto max-w-3xl px-4 pb-3">{summarySlot}</div>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
