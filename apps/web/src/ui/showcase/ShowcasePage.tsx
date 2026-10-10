import { useState, type ReactNode } from "react";
import {
  CalendarDaysIcon,
  CheckIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Alert, type AlertTone } from "../atoms/Alert";
import { Button, type ButtonSize, type ButtonVariant } from "../atoms/Button";
import { Checkbox } from "../atoms/Checkbox";
import { Chip, type ChipTone } from "../atoms/Chip";
import { Divider } from "../atoms/Divider";
import { EmptyState } from "../atoms/EmptyState";
import { FormField } from "../atoms/FormField";
import { IconButton } from "../atoms/IconButton";
import { Kbd } from "../atoms/Kbd";
import { PriorityDot } from "../atoms/PriorityDot";
import { Radio } from "../atoms/Radio";
import { Skeleton } from "../atoms/Skeleton";
import { Spinner, type SpinnerSize } from "../atoms/Spinner";
import { Switch } from "../atoms/Switch";
import { TextInput } from "../atoms/TextInput";
import { Textarea } from "../atoms/Textarea";
import { Dropdown } from "../molecules/Dropdown";
import { EventCard } from "../molecules/EventCard";
import { Modal } from "../molecules/Modal";
import { SearchField } from "../molecules/SearchField";
import { SectionHeading } from "../molecules/SectionHeading";
import {
  SegmentedControl,
  type SegmentOption,
} from "../molecules/SegmentedControl";
import { SlideOver } from "../molecules/SlideOver";
import { StatPill, type StatPillTone } from "../molecules/StatPill";
import { ThemeToggle } from "../molecules/ThemeToggle";
import { AppShell } from "../organisms/AppShell";
import { TimelineView } from "../organisms/TimelineView";
import { CalendarView } from "../organisms/CalendarView";
import { SummaryBar } from "../organisms/SummaryBar";
import { EventDrawer } from "../organisms/EventDrawer";
import { EventWizard } from "../organisms/EventWizard";
import { WizardStepOne } from "../organisms/WizardStepOne";
import { WizardStepTwo } from "../organisms/WizardStepTwo";
import { WizardStepThree } from "../organisms/WizardStepThree";
import { SearchFilterBar } from "../organisms/SearchFilterBar";
import { SmartInputBox } from "../organisms/SmartInputBox";
import { DemoPanel } from "../organisms/DemoPanel";
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
import type { EventPriority } from "../../core/eventTypes";
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
  channels: ["telegram"],
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
    setText: noop,
    submit: async () => {},
    clear: noop,
    ...overrides,
  };
}

/** Every Button variant × size, exercised by the Button matrix demo. */
const BUTTON_VARIANTS: ButtonVariant[] = [
  "primary",
  "accent",
  "ghost",
  "danger",
  "danger-solid",
];
const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
/** Every Chip tone, exercised by the Chip demo. */
const CHIP_TONES: ChipTone[] = [
  "brand",
  "violet",
  "slate",
  "red",
  "green",
  "amber",
];
/** Every StatPill tone, exercised by the StatPill demo. */
const STAT_TONES: StatPillTone[] = ["brand", "slate", "red", "green", "amber"];
/** Every Spinner size, exercised by the Spinner demo. */
const SPINNER_SIZES: SpinnerSize[] = ["xs", "sm", "md"];
/** Every priority, exercised by the PriorityDot matrix and EventCard demos. */
const PRIORITIES: EventPriority[] = ["critical", "medium", "low"];
/** PriorityDot sizes for the matrix demo. */
const DOT_SIZES = ["sm", "md", "lg"] as const;

/**
 * A single component demo card inside the Atoms / Molecules sections.
 *
 * Thin wrapper: an h3 title, an optional caption, and the demo content.
 */
function DemoBlock({
  title,
  caption,
  children,
}: {
  /** The component name. */
  title: string;
  /** One-line note about the variants shown. */
  caption?: string;
  /** The demo content. */
  children: ReactNode;
}) {
  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      {caption && (
        <p className="mt-0.5 text-xs leading-4 text-slate-500 dark:text-slate-400">
          {caption}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Interactive Checkbox states demo. */
function CheckboxDemo() {
  const [checked, setChecked] = useState(true);
  const [unchecked, setUnchecked] = useState(false);
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <Checkbox label="Checked" checked={checked} onChange={setChecked} />
      <Checkbox label="Unchecked" checked={unchecked} onChange={setUnchecked} />
      <Checkbox label="Disabled" checked={false} onChange={noop} disabled />
    </div>
  );
}

/** Interactive Radio group demo (3 options, one disabled). */
function RadioDemo() {
  const [value, setValue] = useState("medium");
  const options: Array<{
    value: string;
    label: string;
    description: string;
    disabled?: boolean;
  }> = [
    { value: "low", label: "Low", description: "Routine — no reminder rush." },
    { value: "medium", label: "Medium", description: "The default priority." },
    {
      value: "critical",
      label: "Critical",
      description: "Can't be missed.",
      disabled: true,
    },
  ];
  return (
    <div className="max-w-sm space-y-2">
      {options.map((o) => (
        <Radio
          key={o.value}
          name="showcase-priority"
          value={o.value}
          label={o.label}
          description={o.description}
          disabled={o.disabled}
          checked={value === o.value}
          onChange={setValue}
        />
      ))}
    </div>
  );
}

/** Interactive Switch demo (on / off / disabled). */
function SwitchDemo() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <Switch label="Notifications on" checked={on} onChange={setOn} />
      <Switch label="Notifications off" checked={off} onChange={setOff} />
      <Switch label="Disabled" checked={false} onChange={noop} disabled />
    </div>
  );
}

/** Controlled SearchField demo, seeded with an initial query. */
function SearchFieldDemo({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SearchField
      label="Search events"
      placeholder="Search events…"
      value={value}
      onChange={setValue}
    />
  );
}

/** Interactive Dropdown demo. */
function DropdownDemo() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Dropdown
      label="Filter by priority"
      placeholder="Priority"
      value={value}
      onChange={setValue}
      options={[
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "critical", label: "Critical" },
      ]}
    />
  );
}

/** The segmented-control demo value type. */
type DemoView = "month" | "week" | "agenda";

/** Interactive SegmentedControl demo (3 options). */
function SegmentedDemo() {
  const [view, setView] = useState<DemoView>("month");
  const options: Array<SegmentOption<DemoView>> = [
    { id: "month", label: "Month" },
    { id: "week", label: "Week" },
    { id: "agenda", label: "Agenda" },
  ];
  return (
    <SegmentedControl
      label="Calendar view"
      options={options}
      value={view}
      onChange={setView}
    />
  );
}

/** Modal demo: a button that opens the dialog. */
function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open modal
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="showcase-modal-title"
      >
        <h3
          id="showcase-modal-title"
          className="text-base font-semibold text-slate-900 dark:text-slate-100"
        >
          Demo modal
        </h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          This dialog uses <Kbd>role=&quot;dialog&quot;</Kbd> with{" "}
          <Kbd>aria-modal</Kbd>: focus is trapped while it is open and returned
          to the trigger on close. Press <Kbd>Esc</Kbd> or click the backdrop
          to dismiss.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** SlideOver demo: a button that opens the right-side panel. */
function SlideOverDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open slide-over
      </Button>
      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="showcase-slideover-title"
      >
        <h3
          id="showcase-slideover-title"
          className="text-base font-semibold text-slate-900 dark:text-slate-100"
        >
          Demo slide-over
        </h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Same dialog contract as the modal — focus trap, <Kbd>Esc</Kbd> to
          close, focus returned to the trigger — sliding in from the right.
        </p>
        <div className="mt-4">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </SlideOver>
    </>
  );
}

/** Focus-ring demo for the Accessibility section (interactive controls). */
function FocusDemo() {
  const [checked, setChecked] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Focusable button</Button>
      <IconButton label="Close">
        <XMarkIcon aria-hidden="true" className="h-5 w-5" />
      </IconButton>
      <TextInput
        aria-label="Focusable input"
        placeholder="Focusable input"
        className="w-48"
      />
      <Checkbox label="Focusable checkbox" checked={checked} onChange={setChecked} />
    </div>
  );
}

/** The sticky section nav with anchor links and a theme note. */
function ShowcaseNav() {
  const links = [
    { href: "#atoms", label: "Atoms" },
    { href: "#molecules", label: "Molecules" },
    { href: "#organisms", label: "Organisms" },
    { href: "#accessibility", label: "Accessibility" },
  ];
  return (
    <nav
      aria-label="Showcase sections"
      className="sticky top-0 z-40 -mx-4 border-b border-slate-200/70 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800/70 dark:bg-ink-950/80"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-brand-600 dark:text-brand-400">
          Gallery
        </span>
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            {l.label}
          </a>
        ))}
        <span className="ml-auto hidden text-xs text-slate-400 sm:block dark:text-slate-500">
          Dark previews wrap components in <code>.dark</code>; demos run in a
          memory ThemeProvider.
        </span>
      </div>
    </nav>
  );
}

/** The Atoms gallery: every atom with its variants and states. */
function AtomsSection() {
  return (
    <section id="atoms" aria-label="Atoms" className="scroll-mt-24 space-y-4">
      <SectionHeading
        eyebrow="Foundation"
        title="Atoms"
        description="The smallest building blocks — buttons, inputs, feedback and typography helpers. Everything below is live: toggle the controls, open the states."
      />
      <div className="space-y-4">
        <DemoBlock
          title="Button"
          caption="All 5 variants × 3 sizes, plus square, loading, disabled and full-width states."
        >
          <div className="space-y-3">
            {BUTTON_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-2">
                <span className="w-24 shrink-0 text-xs font-medium capitalize text-slate-500 dark:text-slate-400">
                  {variant}
                </span>
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    Button
                  </Button>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button variant="primary" square aria-label="Add event">
                <PlusIcon aria-hidden="true" className="h-5 w-5" />
              </Button>
              <Button variant="primary" loading>
                Saving…
              </Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <Button variant="accent" fullWidth className="mt-1">
                Full width
              </Button>
            </div>
          </div>
        </DemoBlock>

        <DemoBlock
          title="IconButton"
          caption="Single-icon 40×40 buttons; the label prop is the accessible name."
        >
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label="Add event">
              <PlusIcon aria-hidden="true" className="h-5 w-5" />
            </IconButton>
            <IconButton label="Close" variant="primary">
              <XMarkIcon aria-hidden="true" className="h-5 w-5" />
            </IconButton>
            <IconButton label="Disabled" disabled>
              <PlusIcon aria-hidden="true" className="h-5 w-5" />
            </IconButton>
          </div>
        </DemoBlock>

        <DemoBlock title="Chip" caption="All 6 tones, one with a leading icon.">
          <div className="flex flex-wrap gap-2">
            {CHIP_TONES.map((tone) => (
              <Chip key={tone} tone={tone}>
                {tone}
              </Chip>
            ))}
            <Chip
              tone="brand"
              icon={<CheckIcon aria-hidden="true" className="h-3.5 w-3.5" />}
            >
              With icon
            </Chip>
          </div>
        </DemoBlock>

        <DemoBlock
          title="PriorityDot"
          caption="All 3 priorities × 3 sizes — gradient status orbs."
        >
          <div className="space-y-2">
            {PRIORITIES.map((priority) => (
              <div key={priority} className="flex items-center gap-4">
                <span className="w-16 shrink-0 text-xs font-medium capitalize text-slate-500 dark:text-slate-400">
                  {priority}
                </span>
                {DOT_SIZES.map((size) => (
                  <span key={size} className="flex items-center gap-1.5">
                    <PriorityDot priority={priority} size={size} />
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {size}
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </DemoBlock>

        <DemoBlock
          title="Checkbox"
          caption="Checked / unchecked / disabled — label rendered next to the box."
        >
          <CheckboxDemo />
        </DemoBlock>

        <DemoBlock
          title="Radio"
          caption="A group of 3 with descriptions; one option disabled."
        >
          <RadioDemo />
        </DemoBlock>

        <DemoBlock title="Switch" caption="On / off / disabled toggle switches.">
          <SwitchDemo />
        </DemoBlock>

        <DemoBlock
          title="TextInput"
          caption="Default, validation-error (aria-invalid) and disabled states."
        >
          <div className="max-w-sm space-y-3">
            <ShowcaseState label="Default">
              <TextInput aria-label="Event title" placeholder="Event title" />
            </ShowcaseState>
            <ShowcaseState label="Error">
              <TextInput
                aria-label="Event title with error"
                placeholder="Event title"
                error="Title is required"
                defaultValue=" "
              />
            </ShowcaseState>
            <ShowcaseState label="Disabled">
              <TextInput
                aria-label="Disabled input"
                placeholder="Can't type here"
                disabled
              />
            </ShowcaseState>
          </div>
        </DemoBlock>

        <DemoBlock title="Textarea" caption="Multi-line input, default and error.">
          <div className="max-w-sm space-y-3">
            <ShowcaseState label="Default">
              <Textarea aria-label="Notes" placeholder="Notes…" />
            </ShowcaseState>
            <ShowcaseState label="Error">
              <Textarea
                aria-label="Notes with error"
                placeholder="Notes…"
                error="Notes are too long"
                defaultValue=" "
              />
            </ShowcaseState>
          </div>
        </DemoBlock>

        <DemoBlock
          title="FormField"
          caption="Label + control + hint / error stack; error links via aria-describedby."
        >
          <div className="max-w-sm space-y-4">
            <ShowcaseState label="With hint">
              <FormField
                label="Event title"
                htmlFor="showcase-field-title"
                hint="Keep it short — this is what the reminder shows."
              >
                <TextInput
                  id="showcase-field-title"
                  placeholder="Dentist appointment"
                />
              </FormField>
            </ShowcaseState>
            <ShowcaseState label="With error">
              <FormField
                label="Event title"
                htmlFor="showcase-field-title-error"
                error="Title is required"
                required
              >
                <TextInput
                  id="showcase-field-title-error"
                  placeholder="Dentist appointment"
                  error="Title is required"
                />
              </FormField>
            </ShowcaseState>
          </div>
        </DemoBlock>

        <DemoBlock
          title="Skeleton"
          caption="Shimmer loading placeholders (aria-hidden — pair with a Spinner for announcements)."
        >
          <div className="max-w-sm space-y-2">
            <Skeleton className="h-4 w-1/3 rounded-md" />
            <Skeleton className="h-4 w-2/3 rounded-md" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-4 w-1/2 rounded-md" />
            </div>
          </div>
        </DemoBlock>

        <DemoBlock
          title="Spinner"
          caption="Indeterminate loader with role=status in 3 sizes."
        >
          <div className="flex items-center gap-4">
            {SPINNER_SIZES.map((size) => (
              <span key={size} className="flex items-center gap-1.5">
                <Spinner size={size} />
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {size}
                </span>
              </span>
            ))}
          </div>
        </DemoBlock>

        <DemoBlock title="Kbd" caption="Keyboard-key chips for shortcuts.">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span className="flex gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
            <span>quick add</span>
            <Kbd>Esc</Kbd>
            <span>close</span>
            <Kbd>/</Kbd>
            <span>search</span>
          </div>
        </DemoBlock>

        <DemoBlock title="Divider" caption="Hairline rule between content.">
          <div className="space-y-3 text-sm text-slate-500 dark:text-slate-400">
            <p>Above the divider</p>
            <Divider />
            <p>Below the divider</p>
          </div>
        </DemoBlock>

        <DemoBlock
          title="Alert"
          caption="All 3 tones: error is role=alert, info/success are role=status."
        >
          <div className="max-w-lg space-y-3">
            {(["error", "info", "success"] as AlertTone[]).map((tone) => (
              <Alert key={tone} tone={tone} title={`This is a ${tone} alert`}>
                The alert body explains what happened and what to do next.
              </Alert>
            ))}
          </div>
        </DemoBlock>

        <DemoBlock
          title="EmptyState"
          caption="Centered placeholder with icon, copy and an action slot."
        >
          <div className="max-w-md">
            <EmptyState
              icon={<CalendarDaysIcon aria-hidden="true" />}
              title="No events yet"
              description="Create your first event and it will show up here, with reminders on time."
              action={
                <Button variant="primary" size="sm" onClick={noop}>
                  Create event
                </Button>
              }
            />
          </div>
        </DemoBlock>
      </div>
    </section>
  );
}

/** The Molecules gallery: composed controls with live interactive demos. */
function MoleculesSection() {
  return (
    <section
      id="molecules"
      aria-label="Molecules"
      className="scroll-mt-24 space-y-4"
    >
      <SectionHeading
        eyebrow="Composed"
        title="Molecules"
        description="Atoms working together — search, pickers, cards and dialogs. The demos below are fully interactive."
      />
      <div className="space-y-4">
        <DemoBlock
          title="SearchField"
          caption="Controlled search input with a clear button."
        >
          <div className="max-w-sm space-y-3">
            <ShowcaseState label="With text">
              <SearchFieldDemo initial="dentist" />
            </ShowcaseState>
            <ShowcaseState label="Empty">
              <SearchFieldDemo initial="" />
            </ShowcaseState>
          </div>
        </DemoBlock>

        <DemoBlock
          title="Dropdown"
          caption="Interactive: open it, pick an option, clear it. Arrow keys navigate."
        >
          <div className="max-w-xs">
            <DropdownDemo />
          </div>
        </DemoBlock>

        <DemoBlock
          title="SegmentedControl"
          caption="Interactive 3-option group; arrow keys move between segments."
        >
          <SegmentedDemo />
        </DemoBlock>

        <DemoBlock
          title="ThemeToggle"
          caption="The dark/light toggle, shown in both themes."
        >
          <div className="flex flex-wrap gap-6">
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
          </div>
        </DemoBlock>

        <DemoBlock
          title="EventCard"
          caption="One per priority; the middle card shows every prop at once."
        >
          <div className="max-w-md space-y-2">
            <EventCard
              title="HRA quarterly check-up"
              timeLabel="Sat 10:00–11:30"
              priority="critical"
              onClick={noop}
            />
            <EventCard
              title="Product design review"
              description="Review the new onboarding flow with the team. Bring the Figma link and the open questions doc."
              timeLabel="Fri 14:30–15:30"
              relativeLabel="in 2h"
              recurrenceBadge={<Chip tone="violet">Weekly</Chip>}
              tagLabel="work"
              priority="medium"
              onClick={noop}
            />
            <EventCard
              title="Water the plants"
              timeLabel="Sun 09:00"
              priority="low"
              onClick={noop}
            />
          </div>
        </DemoBlock>

        <DemoBlock title="StatPill" caption="All 5 tones, one with a leading icon.">
          <div className="flex flex-wrap gap-2">
            {STAT_TONES.map((tone) => (
              <StatPill key={tone} label="events" value="12" tone={tone} />
            ))}
            <StatPill
              icon={<CheckIcon aria-hidden="true" className="h-4 w-4" />}
              label="done"
              value="8"
              tone="green"
            />
          </div>
        </DemoBlock>

        <DemoBlock
          title="SectionHeading"
          caption="Eyebrow + title + description + trailing action (this very pattern heads every gallery section)."
        >
          <SectionHeading
            eyebrow="September 2026"
            title="Timeline"
            description="Your upcoming events, grouped by month."
            action={
              <Button variant="ghost" size="sm" onClick={noop}>
                Today
              </Button>
            }
          />
        </DemoBlock>

        <DemoBlock
          title="Modal"
          caption="Centered dialog — focus trap, Esc/backdrop to close, focus return."
        >
          <ModalDemo />
        </DemoBlock>

        <DemoBlock
          title="SlideOver"
          caption="Right-side panel — the same dialog contract, sliding in."
        >
          <SlideOverDemo />
        </DemoBlock>
      </div>
    </section>
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

/**
 * The Organisms gallery: the full screens and flows, unchanged from the
 * previous gallery except for import paths and the page structure around
 * them. ThemeToggle moved up to Molecules.
 */
function OrganismsSection() {
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
    <section
      id="organisms"
      aria-label="Organisms"
      className="scroll-mt-24 space-y-4"
    >
      <SectionHeading
        eyebrow="Screens"
        title="Organisms"
        description="Full views and flows with fake services injected — populated, empty, loading and error states."
      />
      <div className="space-y-4">
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
                  {...headerSlots(
                    <SummaryBar />,
                    <SearchFilterBarDemo />,
                    <SmartInputBoxDemo />,
                  )}
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
                    {...headerSlots(
                      <SummaryBar />,
                      <SearchFilterBarDemo />,
                      <SmartInputBoxDemo />,
                    )}
                  >
                    <TimelineView />
                  </AppShell>
                </ThemeProvider>
              </ShowcaseServicesProvider>
            </ShowcaseState>
          </div>
          <ShowcaseState label={narrow ? "Narrow (mobile)" : "Wide (desktop)"}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNarrow((v) => !v)}
              className="mb-2"
            >
              Toggle width
            </Button>
            <div className={narrow ? "max-w-[22rem]" : "w-full"}>
              <ShowcaseServicesProvider scenario="populated">
                <ThemeProvider storage={createMemoryThemeStorage("light")}>
                  <AppShell
                    view="timeline"
                    onViewChange={noop}
                    {...headerSlots(
                      <SummaryBar />,
                      <SearchFilterBarDemo />,
                      <SmartInputBoxDemo />,
                    )}
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
            <WizardStepOne
              draft={SAMPLE_DRAFT}
              errors={SAMPLE_DRAFT_ERRORS}
              onChange={noop}
            />
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
              filter={{
                text: "design",
                priority: "medium",
                tag: "work",
                month: "2026-09",
              }}
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
            <SmartInputBox
              smartInput={smartInputState({
                text: "lunch friday",
                parsing: true,
              })}
            />
          </ShowcaseState>
        </ShowcaseSection>

        {/* DemoPanel — populated */}
        <ShowcaseSection title="DemoPanel" caption="The project info card.">
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
    </section>
  );
}

/** Keyboard-shortcut rows for the Accessibility section's shortcut map. */
const SHORTCUTS: Array<{ keys: string[]; action: string }> = [
  { keys: ["/"], action: "Focus search" },
  { keys: ["C"], action: "New event" },
  { keys: ["Esc"], action: "Close dialog / drawer / dropdown" },
  { keys: ["↑", "↓"], action: "Navigate dropdown options" },
  { keys: ["←", "→"], action: "Move segmented control / calendar days" },
  { keys: ["Enter", "Space"], action: "Activate the focused control" },
  { keys: ["Tab", "Shift+Tab"], action: "Move focus (trapped inside dialogs)" },
];

/** The Accessibility gallery: focus, skip links, shortcuts, motion, ARIA. */
function AccessibilitySection() {
  return (
    <section
      id="accessibility"
      aria-label="Accessibility"
      className="scroll-mt-24 space-y-4"
    >
      <SectionHeading
        eyebrow="Inclusive by default"
        title="Accessibility"
        description="The interaction contracts every component follows — try them with a keyboard."
      />
      <div className="space-y-4">
        <DemoBlock
          title="Keyboard focus"
          caption="Tab through — every control shows the same 2px brand outline (the global :focus-visible rule). No component adds its own focus ring."
        >
          <FocusDemo />
        </DemoBlock>

        <DemoBlock
          title="Skip link"
          caption="This page starts with a skip link: press Tab on load and jump straight to the gallery content."
        >
          <p className="text-sm text-slate-500 dark:text-slate-400">
            The link <Kbd>Skip to components</Kbd> targets{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
              #showcase-main
            </code>{" "}
            and uses the shared{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
              .skip-link
            </code>{" "}
            utility — visually hidden until{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
              :focus-visible
            </code>
            , when it slides into view.
          </p>
        </DemoBlock>

        <DemoBlock
          title="Keyboard shortcuts"
          caption="The shortcut map the app follows."
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th
                  scope="col"
                  className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  Shortcut
                </th>
                <th
                  scope="col"
                  className="py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr
                  key={s.action}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="py-2 pr-4">
                    <span className="flex gap-1">
                      {s.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </td>
                  <td className="py-2 text-slate-600 dark:text-slate-300">
                    {s.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DemoBlock>

        <DemoBlock
          title="Reduced motion"
          caption="All animation collapses under prefers-reduced-motion (see styles/index.css)."
        >
          <p className="text-sm text-slate-500 dark:text-slate-400">
            The{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
              @media (prefers-reduced-motion: reduce)
            </code>{" "}
            block disables the enter/pop/slide/shimmer/drift keyframes, so
            dialogs appear instantly and skeletons render as static blocks for
            users who ask for less motion.
          </p>
        </DemoBlock>

        <DemoBlock
          title="ARIA patterns"
          caption="The roles and wiring each pattern uses."
        >
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-semibold text-slate-900 dark:text-slate-100">
                Dialogs
              </dt>
              <dd className="mt-0.5 text-slate-500 dark:text-slate-400">
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
                  role=&quot;dialog&quot;
                </code>{" "}
                +{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
                  aria-modal=&quot;true&quot;
                </code>
                ; focus is trapped while open and returned to the trigger on
                close (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
                  useDialogA11y
                </code>
                ).
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-900 dark:text-slate-100">
                Alerts
              </dt>
              <dd className="mt-0.5 text-slate-500 dark:text-slate-400">
                Errors assert with{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
                  role=&quot;alert&quot;
                </code>
                ; info and success announce politely with{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
                  role=&quot;status&quot;
                </code>
                .
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-900 dark:text-slate-100">
                Form errors
              </dt>
              <dd className="mt-0.5 text-slate-500 dark:text-slate-400">
                Invalid controls get{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
                  aria-invalid=&quot;true&quot;
                </code>{" "}
                and{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
                  aria-describedby
                </code>{" "}
                pointing at the{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-ink-800">
                  {"<id>-error"}
                </code>{" "}
                message rendered by FormField.
              </dd>
            </div>
          </dl>
        </DemoBlock>
      </div>
    </section>
  );
}

/**
 * The dev-only component Showcase gallery (issue #56).
 *
 * Renders every UI component in `src/ui/{atoms,molecules,organisms}` in
 * atomic-design order — Atoms, Molecules, Organisms — plus an Accessibility
 * section documenting the interaction contracts. The gallery is purely
 * presentational: it injects fake services via `ShowcaseServicesProvider` (the
 * same context-injection pattern the real app uses) and passes hand-built
 * view-model state to the prop-driven components, so no backend is needed and
 * no business logic lives here. Reachable in dev via the `?showcase` query
 * (see `isShowcaseLocation` in `src/core/showcaseRoute`).
 */
export function ShowcasePage() {
  return (
    <>
      <a href="#showcase-main" className="skip-link">
        Skip to components
      </a>
      <div className="mx-auto max-w-4xl px-4 pb-20">
        <ShowcaseNav />
        <main id="showcase-main" className="space-y-10 pt-6">
          <header>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Component Showcase
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              Dev-only gallery of every UI component and its key states. No
              backend required — services are injected via context.
            </p>
          </header>
          <AtomsSection />
          <MoleculesSection />
          <OrganismsSection />
          <AccessibilitySection />
        </main>
      </div>
    </>
  );
}
