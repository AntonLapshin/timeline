import type { ReactNode } from "react";
import { CheckIcon, PlusIcon, CalendarDaysIcon } from "@heroicons/react/24/outline";
import { Alert, type AlertTone } from "../atoms/Alert";
import { Button, type ButtonSize, type ButtonVariant } from "../atoms/Button";
import { Chip, type ChipTone } from "../atoms/Chip";
import { Divider } from "../atoms/Divider";
import { EmptyState } from "../atoms/EmptyState";
import { FormField } from "../atoms/FormField";
import { IconButton } from "../atoms/IconButton";
import { Kbd } from "../atoms/Kbd";
import { PriorityDot } from "../atoms/PriorityDot";
import { Skeleton } from "../atoms/Skeleton";
import { Spinner, type SpinnerSize } from "../atoms/Spinner";
import { TextInput } from "../atoms/TextInput";
import { Textarea } from "../atoms/Textarea";
import { EventCard } from "../molecules/EventCard";
import { SectionHeading } from "../molecules/SectionHeading";
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
import { ShowcaseServicesProvider } from "./showcaseServices.tsx";
import type { EventPriority } from "../../core/eventTypes";
import type { EventDrawerState } from "../viewModels/useEventDrawer";
import type { EventWizardState } from "../viewModels/useEventWizard";
import type { SmartInputState } from "../viewModels/useSmartInput";
import { ThemeProvider } from "../theme/ThemeProvider";
import { createMemoryThemeStorage } from "../../adapters/themeStorage";
import {
  AppShellWidthDemo,
  CheckboxDemo,
  DropdownDemo,
  FocusDemo,
  ModalDemo,
  RadioDemo,
  SearchFieldDemo,
  SegmentedDemo,
  SlideOverDemo,
  SmartInputBoxDemo,
  SearchFilterBarDemo,
  SwitchDemo,
} from "./storyDemos";
import type { EventDraft, DraftErrors } from "../../core/eventWizard";
import {
  SHOWCASE_EVENTS,
  SHOWCASE_OCCURRENCES,
  SHOWCASE_DELIVERIES,
} from "./showcaseData";
import { toOccurrenceRow } from "../../core/calendar";
import { reminderPreview } from "../../core/eventDrawer";
import { deliveryLogRows } from "../../core/deliveryLog";

/**
 * The Storybook registry.
 *
 * Each entry ("file") is one component; each story is one isolated
 * variant/state rendered on the canvas. The ShowcasePage shell renders a
 * sidebar from this registry and deep-links with `?showcase&file=X&story=Y`.
 */

/** A single isolated story: one variant or state of a component. */
export interface Story {
  /** Story name, e.g. "Variants". Used in the URL (`&story=…`). */
  name: string;
  /** One-line description shown above the canvas. */
  description?: string;
  /** Renders the isolated demo. May be interactive (local state). */
  render: () => ReactNode;
}

/** Storybook groups, in sidebar order. */
export type StoryGroup = "Atoms" | "Molecules" | "Organisms" | "Guidelines";

export const GROUP_ORDER: StoryGroup[] = [
  "Atoms",
  "Molecules",
  "Organisms",
  "Guidelines",
];

/** One component's story collection. */
export interface StoryFile {
  /** Component name, e.g. "Button". Used in the URL (`&file=…`). */
  name: string;
  group: StoryGroup;
  /** Short blurb shown on the canvas header. */
  description: string;
  stories: Story[];
}

/** A no-op change handler for the read-only previews. */
const noop = () => {};

/** A populated wizard draft used by the wizard / step previews. */
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

/** Every Button variant × size, exercised by the Button stories. */
const BUTTON_VARIANTS: ButtonVariant[] = [
  "primary",
  "accent",
  "ghost",
  "danger",
  "danger-solid",
];
const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
/** Every Chip tone. */
const CHIP_TONES: ChipTone[] = ["brand", "violet", "slate", "red", "green", "amber"];
/** Every StatPill tone. */
const STAT_TONES: StatPillTone[] = ["brand", "slate", "red", "green", "amber"];
/** Every Spinner size. */
const SPINNER_SIZES: SpinnerSize[] = ["xs", "sm", "md"];
/** Every priority. */
const PRIORITIES: EventPriority[] = ["critical", "medium", "low"];
/** PriorityDot sizes. */
const DOT_SIZES = ["sm", "md", "lg"] as const;

/** The full story registry, in sidebar order. */
export const STORY_FILES: StoryFile[] = [
  // ── Atoms ──────────────────────────────────────────────
  {
    name: "Button",
    group: "Atoms",
    description:
      "The shared button: 5 variants × 3 sizes, square icon mode, loading and full-width states.",
    stories: [
      {
        name: "Variants × sizes",
        description: "Every variant in small, medium and large.",
        render: () => (
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
          </div>
        ),
      },
      {
        name: "States",
        description: "Square icon, loading, disabled and full-width.",
        render: () => (
          <div className="flex flex-wrap items-center gap-2">
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
        ),
      },
    ],
  },
  {
    name: "IconButton",
    group: "Atoms",
    description:
      "Single-icon 32×32 buttons; the label prop is the accessible name.",
    stories: [
      {
        name: "Variants",
        render: () => (
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label="Add event">
              <PlusIcon aria-hidden="true" className="h-5 w-5" />
            </IconButton>
            <IconButton label="Close" variant="primary">
              <CheckIcon aria-hidden="true" className="h-5 w-5" />
            </IconButton>
            <IconButton label="Disabled" disabled>
              <PlusIcon aria-hidden="true" className="h-5 w-5" />
            </IconButton>
          </div>
        ),
      },
    ],
  },
  {
    name: "Chip",
    group: "Atoms",
    description: "Small status/label chips in 6 tones.",
    stories: [
      {
        name: "Tones",
        description: "All 6 tones, one with a leading icon.",
        render: () => (
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
        ),
      },
    ],
  },
  {
    name: "PriorityDot",
    group: "Atoms",
    description: "Gradient status orbs for event priorities.",
    stories: [
      {
        name: "Priorities × sizes",
        render: () => (
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
        ),
      },
    ],
  },
  {
    name: "Checkbox",
    group: "Atoms",
    description: "Styled checkbox with a native input underneath.",
    stories: [
      {
        name: "States",
        description: "Checked / unchecked / disabled — label next to the box.",
        render: () => <CheckboxDemo />,
      },
    ],
  },
  {
    name: "Radio",
    group: "Atoms",
    description: "Styled radio with label and optional description.",
    stories: [
      {
        name: "Group",
        description: "A group of 3 with descriptions; one option disabled.",
        render: () => <RadioDemo />,
      },
    ],
  },
  {
    name: "Switch",
    group: "Atoms",
    description: "Toggle switch with a native checkbox underneath.",
    stories: [
      {
        name: "States",
        description: "On / off / disabled.",
        render: () => <SwitchDemo />,
      },
    ],
  },
  {
    name: "TextInput",
    group: "Atoms",
    description: "Single-line text field.",
    stories: [
      {
        name: "Default",
        render: () => (
          <div className="max-w-sm">
            <TextInput aria-label="Event title" placeholder="Event title" />
          </div>
        ),
      },
      {
        name: "Error",
        description: "Validation error sets aria-invalid.",
        render: () => (
          <div className="max-w-sm">
            <TextInput
              aria-label="Event title with error"
              placeholder="Event title"
              error="Title is required"
              defaultValue=" "
            />
          </div>
        ),
      },
      {
        name: "Disabled",
        render: () => (
          <div className="max-w-sm">
            <TextInput
              aria-label="Disabled input"
              placeholder="Can't type here"
              disabled
            />
          </div>
        ),
      },
    ],
  },
  {
    name: "Textarea",
    group: "Atoms",
    description: "Multi-line text field.",
    stories: [
      {
        name: "Default",
        render: () => (
          <div className="max-w-sm">
            <Textarea aria-label="Notes" placeholder="Notes…" />
          </div>
        ),
      },
      {
        name: "Error",
        render: () => (
          <div className="max-w-sm">
            <Textarea
              aria-label="Notes with error"
              placeholder="Notes…"
              error="Notes are too long"
              defaultValue=" "
            />
          </div>
        ),
      },
    ],
  },
  {
    name: "FormField",
    group: "Atoms",
    description: "Label + control + hint / error stack.",
    stories: [
      {
        name: "With hint",
        description: "Hint text linked via aria-describedby.",
        render: () => (
          <div className="max-w-sm">
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
          </div>
        ),
      },
      {
        name: "With error",
        description: "Error linked via aria-describedby; control gets aria-invalid.",
        render: () => (
          <div className="max-w-sm">
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
          </div>
        ),
      },
    ],
  },
  {
    name: "Skeleton",
    group: "Atoms",
    description: "Shimmer loading placeholders (aria-hidden — pair with a Spinner for announcements).",
    stories: [
      {
        name: "Placeholders",
        render: () => (
          <div className="max-w-sm space-y-2">
            <Skeleton className="h-4 w-1/3 rounded-md" />
            <Skeleton className="h-4 w-2/3 rounded-md" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-4 w-1/2 rounded-md" />
            </div>
          </div>
        ),
      },
    ],
  },
  {
    name: "Spinner",
    group: "Atoms",
    description: "Indeterminate loader with role=status.",
    stories: [
      {
        name: "Sizes",
        render: () => (
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
        ),
      },
    ],
  },
  {
    name: "Kbd",
    group: "Atoms",
    description: "Keyboard-key chips for shortcuts.",
    stories: [
      {
        name: "Keys",
        render: () => (
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
        ),
      },
    ],
  },
  {
    name: "Divider",
    group: "Atoms",
    description: "Hairline rule between content.",
    stories: [
      {
        name: "Rule",
        render: () => (
          <div className="space-y-3 text-sm text-slate-500 dark:text-slate-400">
            <p>Above the divider</p>
            <Divider />
            <p>Below the divider</p>
          </div>
        ),
      },
    ],
  },
  {
    name: "Alert",
    group: "Atoms",
    description: "Inline feedback banners.",
    stories: [
      {
        name: "Tones",
        description: "Error is role=alert; info/success are role=status.",
        render: () => (
          <div className="max-w-lg space-y-3">
            {(["error", "info", "success"] as AlertTone[]).map((tone) => (
              <Alert key={tone} tone={tone} title={`This is a ${tone} alert`}>
                The alert body explains what happened and what to do next.
              </Alert>
            ))}
          </div>
        ),
      },
    ],
  },
  {
    name: "EmptyState",
    group: "Atoms",
    description: "Centered placeholder with icon, copy and an action slot.",
    stories: [
      {
        name: "Placeholder",
        render: () => (
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
        ),
      },
    ],
  },

  // ── Molecules ──────────────────────────────────────────
  {
    name: "SearchField",
    group: "Molecules",
    description: "Controlled search input with a clear button.",
    stories: [
      {
        name: "With text",
        render: () => (
          <div className="max-w-sm">
            <SearchFieldDemo initial="dentist" />
          </div>
        ),
      },
      {
        name: "Empty",
        render: () => (
          <div className="max-w-sm">
            <SearchFieldDemo initial="" />
          </div>
        ),
      },
    ],
  },
  {
    name: "Dropdown",
    group: "Molecules",
    description: "Custom listbox dropdown replacing the native select.",
    stories: [
      {
        name: "Interactive",
        description:
          "Open it, pick an option, clear it. Arrow keys navigate; Home/End jump; Esc closes.",
        render: () => (
          <div className="max-w-xs">
            <DropdownDemo />
          </div>
        ),
      },
    ],
  },
  {
    name: "SegmentedControl",
    group: "Molecules",
    description: "Single-select segmented group with a sliding indicator.",
    stories: [
      {
        name: "Interactive",
        description: "Three options; arrow keys move between segments.",
        render: () => <SegmentedDemo />,
      },
    ],
  },
  {
    name: "ThemeToggle",
    group: "Molecules",
    description: "The dark/light theme toggle.",
    stories: [
      {
        name: "Light",
        render: () => (
          <ThemeProvider storage={createMemoryThemeStorage("light")}>
            <ThemeToggle />
          </ThemeProvider>
        ),
      },
      {
        name: "Dark",
        render: () => (
          <div className="dark">
            <ThemeProvider storage={createMemoryThemeStorage("dark")}>
              <ThemeToggle />
            </ThemeProvider>
          </div>
        ),
      },
    ],
  },
  {
    name: "EventCard",
    group: "Molecules",
    description:
      "The timeline/occurrence card: a real button with a priority stripe.",
    stories: [
      {
        name: "Priorities",
        description: "One per priority; the middle card shows every prop at once.",
        render: () => (
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
        ),
      },
    ],
  },
  {
    name: "StatPill",
    group: "Molecules",
    description: "Small statistic pills for summary bars.",
    stories: [
      {
        name: "Tones",
        description: "All 5 tones, one with a leading icon.",
        render: () => (
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
        ),
      },
    ],
  },
  {
    name: "SectionHeading",
    group: "Molecules",
    description: "Eyebrow + title + description + trailing action.",
    stories: [
      {
        name: "Example",
        render: () => (
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
        ),
      },
    ],
  },
  {
    name: "Modal",
    group: "Molecules",
    description: "Accessible centered dialog (portal, focus trap, Esc).",
    stories: [
      {
        name: "Dialog",
        description:
          "Focus is trapped while open and returned to the trigger on close. Press Esc or click the backdrop to dismiss.",
        render: () => <ModalDemo />,
      },
    ],
  },
  {
    name: "SlideOver",
    group: "Molecules",
    description: "Right-side panel with the same dialog contract.",
    stories: [
      {
        name: "Panel",
        description: "Focus trap, Esc to close, focus returned to the trigger.",
        render: () => <SlideOverDemo />,
      },
    ],
  },

  // ── Organisms ──────────────────────────────────────────
  {
    name: "AppShell",
    group: "Organisms",
    description:
      "The app shell with all header slots (summary, search, smart-input, theme toggle) and a Timeline body.",
    stories: [
      {
        name: "Populated",
        render: () => (
          <ShowcaseServicesProvider scenario="populated">
            <ThemeProvider storage={createMemoryThemeStorage("light")}>
              <AppShell
                view="timeline"
                onViewChange={noop}
                summarySlot={<SummaryBar />}
                searchSlot={<SearchFilterBarDemo />}
                smartInputSlot={<SmartInputBoxDemo />}
                themeToggleSlot={<ThemeToggle />}
              >
                <TimelineView />
              </AppShell>
            </ThemeProvider>
          </ShowcaseServicesProvider>
        ),
      },
      {
        name: "Dark",
        render: () => (
          <div className="dark">
            <ShowcaseServicesProvider scenario="populated">
              <ThemeProvider storage={createMemoryThemeStorage("dark")}>
                <AppShell
                  view="timeline"
                  onViewChange={noop}
                  summarySlot={<SummaryBar />}
                  searchSlot={<SearchFilterBarDemo />}
                  smartInputSlot={<SmartInputBoxDemo />}
                  themeToggleSlot={<ThemeToggle />}
                >
                  <TimelineView />
                </AppShell>
              </ThemeProvider>
            </ShowcaseServicesProvider>
          </div>
        ),
      },
      {
        name: "Widths",
        description: "Toggle between desktop and mobile widths.",
        render: () => <AppShellWidthDemo />,
      },
    ],
  },
  {
    name: "TimelineView",
    group: "Organisms",
    description: "The month/week grouped event list.",
    stories: [
      {
        name: "Populated",
        render: () => (
          <ShowcaseServicesProvider scenario="populated">
            <TimelineView />
          </ShowcaseServicesProvider>
        ),
      },
      {
        name: "Empty",
        description: "With the create-first-event call to action.",
        render: () => (
          <ShowcaseServicesProvider scenario="empty">
            <TimelineView onCreate={noop} />
          </ShowcaseServicesProvider>
        ),
      },
      {
        name: "Loading",
        render: () => (
          <ShowcaseServicesProvider scenario="loading">
            <TimelineView />
          </ShowcaseServicesProvider>
        ),
      },
      {
        name: "Error",
        description: "With a retry action.",
        render: () => (
          <ShowcaseServicesProvider scenario="error">
            <TimelineView />
          </ShowcaseServicesProvider>
        ),
      },
    ],
  },
  {
    name: "CalendarView",
    group: "Organisms",
    description:
      "The month grid — use the Month / Week / Agenda tabs to switch sub-modes. The month grid prints cleanly via print styles.",
    stories: [
      {
        name: "Populated",
        render: () => (
          <ShowcaseServicesProvider scenario="populated">
            <CalendarView />
          </ShowcaseServicesProvider>
        ),
      },
      {
        name: "Loading",
        render: () => (
          <ShowcaseServicesProvider scenario="loading">
            <CalendarView />
          </ShowcaseServicesProvider>
        ),
      },
      {
        name: "Error",
        description: "With a retry action.",
        render: () => (
          <ShowcaseServicesProvider scenario="error">
            <CalendarView />
          </ShowcaseServicesProvider>
        ),
      },
    ],
  },
  {
    name: "SummaryBar",
    group: "Organisms",
    description: "Monthly total + per-priority breakdown and next-7-days tally.",
    stories: [
      {
        name: "Populated",
        render: () => (
          <ShowcaseServicesProvider scenario="populated">
            <SummaryBar />
          </ShowcaseServicesProvider>
        ),
      },
      {
        name: "Empty",
        render: () => (
          <ShowcaseServicesProvider scenario="empty">
            <SummaryBar />
          </ShowcaseServicesProvider>
        ),
      },
      {
        name: "Error",
        render: () => (
          <ShowcaseServicesProvider scenario="error">
            <SummaryBar />
          </ShowcaseServicesProvider>
        ),
      },
    ],
  },
  {
    name: "EventDrawer",
    group: "Organisms",
    description:
      "Read-only event details as a right-side slide-over with reminders, next occurrences and the delivery log. Renders open for inspection — press Esc to dismiss.",
    stories: [
      {
        name: "Populated",
        render: () => (
          <EventDrawer drawer={populatedDrawerState()} onEdit={noop} />
        ),
      },
    ],
  },
  {
    name: "EventWizard",
    group: "Organisms",
    description:
      "The 3-step create wizard. Renders open for inspection — press Esc to dismiss.",
    stories: [
      {
        name: "Step 1 — What/When",
        render: () => <EventWizard wizard={wizardStateAt(1)} />,
      },
      {
        name: "Step 2 — Recurrence",
        render: () => <EventWizard wizard={wizardStateAt(2)} />,
      },
      {
        name: "Step 3 — Priority & Reminders",
        render: () => <EventWizard wizard={wizardStateAt(3)} />,
      },
    ],
  },
  {
    name: "WizardStepOne / Two / Three",
    group: "Organisms",
    description: "The individual step forms, rendered directly.",
    stories: [
      {
        name: "Step one",
        render: () => (
          <WizardStepOne
            draft={SAMPLE_DRAFT}
            errors={SAMPLE_DRAFT_ERRORS}
            onChange={noop}
          />
        ),
      },
      {
        name: "Step two",
        render: () => (
          <WizardStepTwo draft={SAMPLE_DRAFT} errors={{}} onChange={noop} />
        ),
      },
      {
        name: "Step three",
        render: () => (
          <WizardStepThree draft={SAMPLE_DRAFT} onChange={noop} />
        ),
      },
    ],
  },
  {
    name: "SearchFilterBar",
    group: "Organisms",
    description: "Text search plus priority/tag/month filters.",
    stories: [
      {
        name: "With options",
        render: () => (
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
        ),
      },
      {
        name: "Active filter",
        render: () => (
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
        ),
      },
      {
        name: "No options",
        render: () => (
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
        ),
      },
    ],
  },
  {
    name: "SmartInputBox",
    group: "Organisms",
    description: "The “Add event…” natural-language box.",
    stories: [
      {
        name: "With text",
        render: () => <SmartInputBox smartInput={smartInputState()} />,
      },
      {
        name: "Error",
        render: () => (
          <SmartInputBox
            smartInput={smartInputState({
              error: "Couldn't understand that. Try being more specific.",
            })}
          />
        ),
      },
      {
        name: "Parsing",
        render: () => (
          <SmartInputBox
            smartInput={smartInputState({ text: "lunch friday", parsing: true })}
          />
        ),
      },
    ],
  },
  {
    name: "DemoPanel",
    group: "Organisms",
    description: "The project info card.",
    stories: [
      {
        name: "Populated",
        render: () => (
          <DemoPanel
            projectName="timeline"
            owner="AntonLapshin"
            repo="timeline"
            status="in-progress"
            description="A personal, local-first global schedule."
          />
        ),
      },
    ],
  },

  // ── Guidelines ─────────────────────────────────────────
  {
    name: "Keyboard",
    group: "Guidelines",
    description: "The shortcut map the app follows.",
    stories: [
      {
        name: "Shortcuts",
        render: () => (
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
              {([
  { keys: ["/"], action: "Focus search" },
  { keys: ["C"], action: "New event" },
  { keys: ["Esc"], action: "Close dialog / drawer / dropdown" },
  { keys: ["↑", "↓"], action: "Navigate dropdown options" },
  { keys: ["←", "→"], action: "Move segmented control / calendar days" },
  { keys: ["Enter", "Space"], action: "Activate the focused control" },
  { keys: ["Tab", "Shift+Tab"], action: "Move focus (trapped inside dialogs)" },
]).map((s) => (
                <tr
                  key={s.action}
                  className="border-b border-slate-100 dark:border-slate-800/60"
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
        ),
      },
    ],
  },
  {
    name: "Focus",
    group: "Guidelines",
    description: "The interaction contracts every component follows.",
    stories: [
      {
        name: "Focus ring",
        description:
          "Tab through — every control shows the same 2px brand outline (the global :focus-visible rule). No component adds its own focus ring.",
        render: () => <FocusDemo />,
      },
      {
        name: "Skip link",
        description:
          "The gallery starts with a skip link: press Tab on load and jump straight to the canvas.",
        render: () => (
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
        ),
      },
    ],
  },
  {
    name: "Motion",
    group: "Guidelines",
    description: "How the interface moves — and when it doesn't.",
    stories: [
      {
        name: "Reduced motion",
        description:
          "When the OS prefers reduced motion, every animation and transition collapses to near-instant via a single global media query — nothing drifts, pulses or staggers.",
        render: () => (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Hover me</Button>
            <div className="card card-interactive w-48 p-3 text-sm text-slate-600 dark:text-slate-300">
              Hover lift card
            </div>
            <p className="w-full text-sm text-slate-500 dark:text-slate-400">
              Staggered entrances (<Kbd>--enter-delay</Kbd>), dialog pops,
              skeleton shimmer and ambient orbs all honor the setting.
            </p>
          </div>
        ),
      },
    ],
  },
];
