import type { ReactNode } from "react";
import { SegmentedControl } from "../molecules/SegmentedControl";
import { Kbd } from "../atoms/Kbd";

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
  /**
   * The URL the logo link points at (the "home" view). Defaults to `/`.
   * Right-click / copy-link friendly; activation is intercepted by
   * `onHomeClick` for SPA navigation without a reload.
   */
  homeHref?: string;
  /**
   * Called when the logo link is activated. The handler must perform the
   * SPA "go home" navigation (view → timeline, transient UI closed); the
   * default anchor navigation is already prevented.
   */
  onHomeClick?: () => void;
}

/**
 * The top-level app shell (issue #21; viewport-height layout issue #123).
 *
 * Provides the no-login localhost layout: a brand header (skip link, logo
 * mark + wordmark linked to the home view, view switcher, theme toggle,
 * actions, and the search/smart-input/summary slots), and the active view's content. The shell
 * is exactly the viewport height (`h-dvh` flex column) over the ambient
 * `.bg-scene` backdrop: the header stays visible and the content area
 * (`<main id="main-content">`) is the single internal scroll container, so
 * the timeline/calendar scroll inside it instead of the whole document — no
 * page-level vertical scrollbar.
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
  homeHref = "/",
  onHomeClick,
}: AppShellProps) {
  return (
    <div className="bg-scene flex h-dvh flex-col overflow-hidden bg-slate-100 dark:bg-ink-950">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="shrink-0 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <a
            href={homeHref}
            onClick={
              onHomeClick
                ? (e) => {
                    e.preventDefault();
                    onHomeClick();
                  }
                : undefined
            }
            aria-label="Timeline home"
            className="flex items-center gap-2.5 rounded-lg"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 shadow-md shadow-brand-600/25"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                className="h-4 w-4 text-white"
              >
                <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
              </svg>
            </span>
            <h1 className="brand-text">Timeline</h1>
          </a>
          <div className="flex items-center gap-2">
            {themeToggleSlot}
            <nav className="flex items-center gap-2" aria-label="Views">
              <SegmentedControl<AppView>
                label="Views"
                value={view}
                onChange={onViewChange}
                options={[
                  { id: "timeline", label: "Timeline" },
                  { id: "calendar", label: "Calendar" },
                ]}
              />
              {actions && (
                <div className="border-l border-slate-200 pl-2 dark:border-white/10">
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
        <p className="mx-auto max-w-3xl px-4 pb-2 text-[11px] text-slate-400 dark:text-slate-500">
          Press <Kbd>/</Kbd> to search · <Kbd>C</Kbd> to create an event
        </p>
      </header>
      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
        <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
