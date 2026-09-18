import { useState, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { TimelineView } from "../components/TimelineView";
import { CalendarView } from "../components/CalendarView";
import { SummaryBar } from "../components/SummaryBar";
import { EventDrawer } from "../components/EventDrawer";
import { EventWizard } from "../components/EventWizard";
import { WizardStepOne } from "../components/WizardStepOne";
import { WizardStepTwo } from "../components/WizardStepTwo";
import { WizardStepThree } from "../components/WizardStepThree";
import { SearchFilterBar } from "../components/SearchFilterBar";
import { SmartInputBox } from "../components/SmartInputBox";
import { ThemeToggle } from "../components/ThemeToggle";
import { DemoPanel } from "../components/DemoPanel";
import { ShowcaseSection } from "./ShowcaseSection";
import { ShowcaseState } from "./ShowcaseSection";
import { ShowcaseServicesProvider } from "./showcaseServices.tsx";
import {
  SHOWCASE_EVENTS,
  SHOWCASE_OCCURRENCES,
  SHOWCASE_DELIVERIES,
} from "./showcaseData";
import { toOccurrenceRow } from "../../core/calendar";
import { reminderPreview } from "../../core/eventDrawer";
import { deliveryLogRows } from "../../core/deliveryLog";
import type { EventDrawerState } from "../viewModels/useEventDrawer";
import type { EventWizardState } from "../viewModels/useEventWizard";
import type { SmartInputState } from "../viewModels/useSmartInput";
import { ThemeProvider } from "../theme/ThemeProvider";
import { createMemoryThemeStorage } from "../../adapters/themeStorage";
import type { EventDraft, DraftErrors } from "../../core/eventWizard";

/** A no-op change handler for the read-only wizard-step previews. */
const noop = () => {};

/** A populated wizard draft used to render the wizard / step previews. */
const SAMPLE_DRAFT: EventDraft = {
  title: "Dentist appointment",
  notes: "Clean + check-up.",
  allDay: false,
  date: "2026-09-20",
  time: "15:00",
  tz: "Europe/Berlin",
  recurrence: "weekly",
  customRrule: "FREQ=WEEKLY;BYDAY=MO",
  priority: "critical",
  channels: ["telegram", "email"],
  reminderOffsets: ["7d", "1d", "2h"],
};

/** A draft with validation errors (for the step-1 error state). */
const SAMPLE_DRAFT_ERRORS: DraftErrors = {
  title: "Title is required",
  date: "Date is required",
};

/** A populated event-drawer state for the drawer preview. */
function populatedDrawerState(): EventDrawerState {
  const event = SHOWCASE_EVENTS[0];
  const occurrences = SHOWCASE_OCCURRENCES.filter(
    (o) => o.event_id === event.id,
  ).map((o) => ({ occurrence: o, row: toOccurrenceRow(o) }));
  return {
    event,
    open: true,
    loading: false,
    error: null,
    preview: reminderPreview(event),
    occurrences,
    deliveriesLoading: false,
    deliveriesError: null,
    deliveries: deliveryLogRows(SHOWCASE_DELIVERIES),
    deleting: false,
    deleteError: null,
    openDrawer: noop,
    openFromOccurrence: async () => {},
    close: noop,
    deleteCurrent: async () => true,
  };
}

/** A wizard state at a given step, used to render the wizard previews. */
function wizardStateAt(step: 1 | 2 | 3): EventWizardState {
  return {
    open: true,
    editingEvent: null,
    step,
    draft: SAMPLE_DRAFT,
    errors: step === 1 ? SAMPLE_DRAFT_ERRORS : {},
    canNext: true,
    saving: false,
    error: null,
    openCreate: noop,
    openCreateWithDraft: noop,
    openEdit: noop,
    close: noop,
    next: noop,
    back: noop,
    update: noop,
    save: async () => {},
  };
}

/** A populated smart-input state. */
function smartInputState(overrides: Partial<SmartInputState> = {}): SmartInputState {
  return {
    text: "dentist next Tuesday 3pm",
    parsing: false,
    error: null,
    unavailable: false,
    setText: noop,
    submit: async () => {},
    clear: noop,
    ...overrides,
  };
}

/**
 * The dev-only component Showcase gallery (issue #56).
 *
 * Renders every UI component in `src/ui/components` with its key states
 * (empty, populated, error, dark/light, narrow/mobile). The gallery is purely
 * presentational: it injects fake services via `ShowcaseServicesProvider` (the
 * same context-injection pattern the real app uses) and passes hand-built
 * view-model state to the prop-driven components, so no backend is needed and
 * no business logic lives here. Reachable in dev via the `?showcase` query.
 */
export function ShowcasePage() {
  const [narrow, setNarrow] = useState(false);

  const headerSlots = (
    summary: ReactNode,
    search: ReactNode,
    smart: ReactNode,
  ) => ({
    summarySlot: summary,
    searchSlot: search,
    smartInputSlot: smart,
    themeToggleSlot: <ThemeToggle />,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Component Showcase
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Dev-only gallery of every UI component and its key states. No backend
          required — services are injected via context.
        </p>
      </header>

      {/* AppShell — populated (light) + dark + narrow */}
      <ShowcaseSection
        title="AppShell"
        caption="The app shell with all header slots (summary, search, smart-input, theme toggle) and a Timeline body."
      >
        <ShowcaseState label="Populated (light)">
          <ShowcaseServicesProvider scenario="populated">
            <ThemeProvider storage={createMemoryThemeStorage("light")}>
              <AppShell
                view="timeline"
                onViewChange={noop}
                {...headerSlots(<SummaryBar />, <SearchFilterBarDemo />, <SmartInputBoxDemo />)}
              >
                <TimelineView />
              </AppShell>
            </ThemeProvider>
          </ShowcaseServicesProvider>
        </ShowcaseState>
        <div className="dark">
          <ShowcaseState label="Dark">
            <ShowcaseServicesProvider scenario="populated">
              <ThemeProvider storage={createMemoryThemeStorage("dark")}>
                <AppShell
                  view="timeline"
                  onViewChange={noop}
                  {...headerSlots(<SummaryBar />, <SearchFilterBarDemo />, <SmartInputBoxDemo />)}
                >
                  <TimelineView />
                </AppShell>
              </ThemeProvider>
            </ShowcaseServicesProvider>
          </ShowcaseState>
        </div>
        <ShowcaseState label={narrow ? "Narrow (mobile)" : "Wide (desktop)"}>
          <button
            type="button"
            onClick={() => setNarrow((v) => !v)}
            className="btn-ghost mb-2 px-2 py-1 text-xs"
          >
            Toggle width
          </button>
          <div className={narrow ? "max-w-[22rem]" : "w-full"}>
            <ShowcaseServicesProvider scenario="populated">
              <ThemeProvider storage={createMemoryThemeStorage("light")}>
                <AppShell
                  view="timeline"
                  onViewChange={noop}
                  {...headerSlots(<SummaryBar />, <SearchFilterBarDemo />, <SmartInputBoxDemo />)}
                >
                  <TimelineView />
                </AppShell>
              </ThemeProvider>
            </ShowcaseServicesProvider>
          </div>
        </ShowcaseState>
      </ShowcaseSection>

      {/* TimelineView — populated + empty + loading + error */}
      <ShowcaseSection
        title="TimelineView"
        caption="The month/week grouped event list: populated, empty (with create CTA), loading and error (with retry) states."
      >
        <ShowcaseState label="Populated">
          <ShowcaseServicesProvider scenario="populated">
            <TimelineView />
          </ShowcaseServicesProvider>
        </ShowcaseState>
        <ShowcaseState label="Empty">
          <ShowcaseServicesProvider scenario="empty">
            <TimelineView onCreate={noop} />
          </ShowcaseServicesProvider>
        </ShowcaseState>
        <ShowcaseState label="Loading">
          <ShowcaseServicesProvider scenario="loading">
            <TimelineView />
          </ShowcaseServicesProvider>
        </ShowcaseState>
        <ShowcaseState label="Error">
          <ShowcaseServicesProvider scenario="error">
            <TimelineView />
          </ShowcaseServicesProvider>
        </ShowcaseState>
      </ShowcaseSection>

      {/* CalendarView — month grid with mode switcher */}
      <ShowcaseSection
        title="CalendarView"
        caption="The month grid (use the Month / Week / Agenda tabs to switch sub-modes), plus loading and error (with retry) states. The month grid prints cleanly via print styles."
      >
        <ShowcaseState label="Populated">
          <ShowcaseServicesProvider scenario="populated">
            <CalendarView />
          </ShowcaseServicesProvider>
        </ShowcaseState>
        <ShowcaseState label="Loading">
          <ShowcaseServicesProvider scenario="loading">
            <CalendarView />
          </ShowcaseServicesProvider>
        </ShowcaseState>
        <ShowcaseState label="Error">
          <ShowcaseServicesProvider scenario="error">
            <CalendarView />
          </ShowcaseServicesProvider>
        </ShowcaseState>
      </ShowcaseSection>

      {/* SummaryBar — populated + empty + error */}
      <ShowcaseSection
        title="SummaryBar"
        caption="Monthly total + per-priority breakdown and next-7-days tally."
      >
        <ShowcaseState label="Populated">
          <ShowcaseServicesProvider scenario="populated">
            <SummaryBar />
          </ShowcaseServicesProvider>
        </ShowcaseState>
        <ShowcaseState label="Empty">
          <ShowcaseServicesProvider scenario="empty">
            <SummaryBar />
          </ShowcaseServicesProvider>
        </ShowcaseState>
        <ShowcaseState label="Error">
          <ShowcaseServicesProvider scenario="error">
            <SummaryBar />
          </ShowcaseServicesProvider>
        </ShowcaseState>
      </ShowcaseSection>

      {/* EventDrawer — populated (the slide-over only renders when an
          event is selected, so there is no empty state to show) */}
      <ShowcaseSection
        title="EventDrawer"
        caption="Read-only event details as a right-side slide-over with reminders, next occurrences and the delivery log."
      >
        <ShowcaseState label="Populated">
          <EventDrawer drawer={populatedDrawerState()} onEdit={noop} />
        </ShowcaseState>
      </ShowcaseSection>

      {/* EventWizard — steps 1–3 */}
      <ShowcaseSection
        title="EventWizard"
        caption="The 3-step create wizard: What/When, Recurrence, Priority & Reminders."
      >
        <ShowcaseState label="Step 1 — What/When">
          <EventWizard wizard={wizardStateAt(1)} />
        </ShowcaseState>
        <ShowcaseState label="Step 2 — Recurrence">
          <EventWizard wizard={wizardStateAt(2)} />
        </ShowcaseState>
        <ShowcaseState label="Step 3 — Priority & Reminders">
          <EventWizard wizard={wizardStateAt(3)} />
        </ShowcaseState>
      </ShowcaseSection>

      {/* WizardStepOne / Two / Three — direct previews */}
      <ShowcaseSection
        title="WizardStepOne / Two / Three"
        caption="The individual step forms, rendered directly."
      >
        <ShowcaseState label="Step One">
          <WizardStepOne draft={SAMPLE_DRAFT} errors={SAMPLE_DRAFT_ERRORS} onChange={noop} />
        </ShowcaseState>
        <ShowcaseState label="Step Two">
          <WizardStepTwo draft={SAMPLE_DRAFT} errors={{}} onChange={noop} />
        </ShowcaseState>
        <ShowcaseState label="Step Three">
          <WizardStepThree draft={SAMPLE_DRAFT} onChange={noop} />
        </ShowcaseState>
      </ShowcaseSection>

      {/* SearchFilterBar — populated options + active filter */}
      <ShowcaseSection
        title="SearchFilterBar"
        caption="Text search plus priority/tag/month filters."
      >
        <ShowcaseState label="With options">
          <SearchFilterBar
            filter={{ text: "", priority: null, tag: null, month: null }}
            tags={["health", "home", "work"]}
            months={["2026-09", "2026-10"]}
            onTextChange={noop}
            onPriorityChange={noop}
            onTagChange={noop}
            onMonthChange={noop}
            onClear={noop}
          />
        </ShowcaseState>
        <ShowcaseState label="Active filter">
          <SearchFilterBar
            filter={{ text: "design", priority: "medium", tag: "work", month: "2026-09" }}
            tags={["health", "home", "work"]}
            months={["2026-09", "2026-10"]}
            onTextChange={noop}
            onPriorityChange={noop}
            onTagChange={noop}
            onMonthChange={noop}
            onClear={noop}
          />
        </ShowcaseState>
        <ShowcaseState label="No options">
          <SearchFilterBar
            filter={{ text: "", priority: null, tag: null, month: null }}
            tags={[]}
            months={[]}
            onTextChange={noop}
            onPriorityChange={noop}
            onTagChange={noop}
            onMonthChange={noop}
            onClear={noop}
          />
        </ShowcaseState>
      </ShowcaseSection>

      {/* SmartInputBox — normal + error + parsing */}
      <ShowcaseSection
        title="SmartInputBox"
        caption="The 'Add event…' natural-language box."
      >
        <ShowcaseState label="With text">
          <SmartInputBox smartInput={smartInputState()} />
        </ShowcaseState>
        <ShowcaseState label="Error">
          <SmartInputBox
            smartInput={smartInputState({
              error: "Couldn't understand that. Try being more specific.",
            })}
          />
        </ShowcaseState>
        <ShowcaseState label="Parsing">
          <SmartInputBox smartInput={smartInputState({ text: "lunch friday", parsing: true })} />
        </ShowcaseState>
      </ShowcaseSection>

      {/* ThemeToggle — light + dark */}
      <ShowcaseSection
        title="ThemeToggle"
        caption="The dark/light toggle, shown in both themes."
      >
        <ShowcaseState label="Light">
          <ThemeProvider storage={createMemoryThemeStorage("light")}>
            <ThemeToggle />
          </ThemeProvider>
        </ShowcaseState>
        <div className="dark">
          <ShowcaseState label="Dark">
            <ThemeProvider storage={createMemoryThemeStorage("dark")}>
              <ThemeToggle />
            </ThemeProvider>
          </ShowcaseState>
        </div>
      </ShowcaseSection>

      {/* DemoPanel — populated */}
      <ShowcaseSection
        title="DemoPanel"
        caption="The project info card."
      >
        <ShowcaseState label="Populated">
          <DemoPanel
            projectName="timeline"
            owner="AntonLapshin"
            repo="timeline"
            status="in-progress"
            description="A personal, local-first global schedule."
          />
        </ShowcaseState>
      </ShowcaseSection>
    </div>
  );
}

/** A self-contained, wired SearchFilterBar demo (no-op callbacks). */
function SearchFilterBarDemo() {
  return (
    <SearchFilterBar
      filter={{ text: "", priority: null, tag: null, month: null }}
      tags={["health", "home", "work"]}
      months={["2026-09"]}
      onTextChange={noop}
      onPriorityChange={noop}
      onTagChange={noop}
      onMonthChange={noop}
      onClear={noop}
    />
  );
}

/** A self-contained, wired SmartInputBox demo (no-op callbacks). */
function SmartInputBoxDemo() {
  return <SmartInputBox smartInput={smartInputState()} />;
}
