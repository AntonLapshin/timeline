import { useEffect, useState } from "react";
import { AppShell, type AppView } from "./ui/components/AppShell";
import { TimelineView } from "./ui/components/TimelineView";
import { CalendarView } from "./ui/components/CalendarView";
import { SummaryBar } from "./ui/components/SummaryBar";
import { EventWizard } from "./ui/components/EventWizard";
import { EventDrawer } from "./ui/components/EventDrawer";
import { ServicesProvider } from "./ui/services/ServicesProvider";
import { useEventWizard } from "./ui/viewModels/useEventWizard";
import { useEventDrawer } from "./ui/viewModels/useEventDrawer";

/**
 * App root.
 *
 * Wraps the tree in the `ServicesProvider` (context injection of apiClient /
 * llmParser) and composes the app shell with the Timeline view. Holds only the
 * active-view UI state; all business logic lives in `src/core`.
 */
export default function App() {
  const [view, setView] = useState<AppView>("timeline");
  const wizard = useEventWizard();
  const drawer = useEventDrawer();

  // Keyboard shortcut: `c` opens the create wizard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "c" && !wizard.open) {
        wizard.openCreate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wizard]);

  return (
    <ServicesProvider>
      <AppShell
        view={view}
        onViewChange={setView}
        summarySlot={<SummaryBar />}
        actions={
          <button
            type="button"
            onClick={wizard.openCreate}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            + New
          </button>
        }
      >
        {view === "timeline" ? (
          <TimelineView onEventClick={drawer.openDrawer} />
        ) : (
          <CalendarView onEventClick={drawer.openFromOccurrence} />
        )}
      </AppShell>
      {drawer.open && (
        <EventDrawer drawer={drawer} onEdit={() => wizard.openEdit(drawer.event!)} />
      )}
      {wizard.open && <EventWizard wizard={wizard} />}
    </ServicesProvider>
  );
}
