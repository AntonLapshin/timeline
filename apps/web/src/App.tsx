import { useState } from "react";
import { AppShell, type AppView } from "./ui/components/AppShell";
import { TimelineView } from "./ui/components/TimelineView";
import { ServicesProvider } from "./ui/services/ServicesProvider";

/**
 * App root.
 *
 * Wraps the tree in the `ServicesProvider` (context injection of apiClient /
 * llmParser) and composes the app shell with the Timeline view. Holds only the
 * active-view UI state; all business logic lives in `src/core`.
 */
export default function App() {
  const [view, setView] = useState<AppView>("timeline");

  return (
    <ServicesProvider>
      <AppShell view={view} onViewChange={setView}>
        {view === "timeline" ? <TimelineView /> : <CalendarPlaceholder />}
      </AppShell>
    </ServicesProvider>
  );
}

/** Placeholder for the Calendar view (wired in a later issue). */
function CalendarPlaceholder() {
  return (
    <p className="text-sm text-slate-500">
      Calendar view is coming in a later milestone.
    </p>
  );
}
