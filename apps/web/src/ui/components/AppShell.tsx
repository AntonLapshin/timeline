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
 * The top-level app shell (issue #21; viewport-height layout issue #123).
 *
 * Provides the no-login localhost layout: a header that hosts the summary-bar
 * slot (wired in a later issue), a view switcher (Timeline / Calendar), and the
 * active view's content. The shell is exactly the viewport height (`h-dvh` flex
 * column): the header stays visible and the content area (`<main>`) is the
 * single internal scroll container, so the timeline/calendar scroll inside it
 * instead of the whole document — no page-level vertical scrollbar.
 *
 * Dumb component — it renders props and calls the `onViewChange` callback; no
 * business logic.
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
    <div className="flex h-dvh flex-col overflow-hidden bg-gradient-to-b from-slate-100 to-slate-200/60 dark:from-slate-950 dark:to-slate-900">
      <header className="shrink-0 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h1 className="bg-gradient-to-r from-slate-900 via-slate-700 to-indigo-600 bg-clip-text text-lg font-bold tracking-tight text-transparent dark:from-slate-100 dark:via-slate-300 dark:to-indigo-400">Timeline</h1>
          <div className="flex items-center gap-2">
            {themeToggleSlot}
            <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/70 bg-slate-100/70 p-1 dark:border-slate-700/60 dark:bg-slate-800/70" aria-label="Views">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={view === tab.id}
                  onClick={() => onViewChange(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium leading-none transition-colors ${
                    view === tab.id
                      ? "bg-white text-slate-900 shadow-md dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/40"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
              {actions && (
                <div className="ml-1 border-l border-slate-200 pl-2 dark:border-slate-600">
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
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">{children}</div>
      </main>
    </div>
  );
}
