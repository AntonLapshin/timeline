import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, type AppView } from "./ui/components/AppShell";
import { TimelineView } from "./ui/components/TimelineView";
import { CalendarView } from "./ui/components/CalendarView";
import { SummaryBar } from "./ui/components/SummaryBar";
import { EventWizard } from "./ui/components/EventWizard";
import { EventDrawer } from "./ui/components/EventDrawer";
import { SearchFilterBar } from "./ui/components/SearchFilterBar";
import { SmartInputBox } from "./ui/components/SmartInputBox";
import { ThemeToggle } from "./ui/components/ThemeToggle";
import { useServices } from "./ui/services/useServices";
import { useEventWizard } from "./ui/viewModels/useEventWizard";
import { useEventDrawer } from "./ui/viewModels/useEventDrawer";
import { useSearchFilter } from "./ui/viewModels/useSearchFilter";
import { useSmartInput } from "./ui/viewModels/useSmartInput";
import { allMonths, allTags } from "./core/searchFilter";
import type { EventRead } from "./core/eventTypes";

/**
 * App root.
 *
 * Composes the app shell with the Timeline/Calendar views and holds the
 * active-view UI state plus the app-wide search/filter state. All business
 * logic lives in `src/core`; services are injected via `useServices()` (the
 * `ServicesProvider` lives in `main.tsx`).
 */
export default function App() {
  const { apiClient } = useServices();
  const [view, setView] = useState<AppView>("timeline");
  // Bumped after a successful wizard save so every data view (timeline,
  // calendar, summary, filter dropdowns) refetches without a reload (#121).
  const [refreshKey, setRefreshKey] = useState(0);
  const drawer = useEventDrawer();
  const search = useSearchFilter();
  // `close` is stable (useCallback in the view model); destructuring keeps the
  // saved-callback identity stable for `useEventWizard`.
  const { close: closeDrawer } = drawer;
  // After a successful wizard save: bump the refresh key so the data views
  // refetch, and close the drawer so it can never show stale details
  // (issue #121).
  const onWizardSaved = useCallback(() => {
    setRefreshKey((k) => k + 1);
    closeDrawer();
  }, [closeDrawer]);
  // After a successful delete the drawer closes itself (view model); bump the
  // refresh key so the timeline, calendar, summary and filter dropdowns
  // refetch without a reload.
  const onEventDeleted = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);
  const wizard = useEventWizard({ onSaved: onWizardSaved });
  const smartInput = useSmartInput(wizard.openCreateWithDraft);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [events, setEvents] = useState<EventRead[]>([]);

  // Fetch the full event list so the tag/month filter dropdowns can be
  // populated. Re-runs when `refreshKey` changes (after a wizard save) so the
  // dropdowns reflect the change without a reload. This is best-effort
  // (options are derived in core); failures are ignored and simply leave the
  // dropdowns empty.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .listEvents()
      .then((list) => {
        if (!cancelled) setEvents(list);
      })
      .catch(() => {
        /* tag/month options are best-effort; ignore load errors */
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, refreshKey]);

  const tagOptions = useMemo(() => allTags(events), [events]);
  const monthOptions = useMemo(() => allMonths(events), [events]);

  // Keyboard shortcuts: `c` opens the create wizard, `/` focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) {
        return;
      }
      if (e.key.toLowerCase() === "c" && !wizard.open) {
        wizard.openCreate();
      } else if (e.key === "/" && !wizard.open) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wizard]);

  return (
    <>
      <AppShell
        view={view}
        onViewChange={setView}
        summarySlot={<SummaryBar refreshKey={refreshKey} />}
        searchSlot={
          <SearchFilterBar
            filter={search.filter}
            tags={tagOptions}
            months={monthOptions}
            inputRef={searchInputRef}
            onTextChange={search.setText}
            onPriorityChange={search.setPriority}
            onTagChange={search.setTag}
            onMonthChange={search.setMonth}
            onClear={search.clear}
          />
        }
        smartInputSlot={<SmartInputBox smartInput={smartInput} />}
        themeToggleSlot={<ThemeToggle />}
        actions={
          <button
            type="button"
            onClick={wizard.openCreate}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            + New
          </button>
        }
      >
        {view === "timeline" ? (
          <TimelineView
            onEventClick={drawer.openDrawer}
            filter={search.filter}
            onCreate={wizard.openCreate}
            refreshKey={refreshKey}
          />
        ) : (
          <CalendarView
            onEventClick={drawer.openFromOccurrence}
            filter={search.filter}
            refreshKey={refreshKey}
          />
        )}
      </AppShell>
      {drawer.open && (
        <EventDrawer
          drawer={drawer}
          onEdit={() => wizard.openEdit(drawer.event!)}
          onDeleted={onEventDeleted}
        />
      )}
      {wizard.open && <EventWizard wizard={wizard} />}
    </>
  );
}
