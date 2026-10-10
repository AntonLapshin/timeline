import { useState } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";
import { Button } from "../atoms/Button";
import { Checkbox } from "../atoms/Checkbox";
import { IconButton } from "../atoms/IconButton";
import { Kbd } from "../atoms/Kbd";
import { Radio } from "../atoms/Radio";
import { Switch } from "../atoms/Switch";
import { TextInput } from "../atoms/TextInput";
import { Dropdown } from "../molecules/Dropdown";
import { Modal } from "../molecules/Modal";
import { SearchField } from "../molecules/SearchField";
import {
  SegmentedControl,
  type SegmentOption,
} from "../molecules/SegmentedControl";
import { SlideOver } from "../molecules/SlideOver";
import { ThemeToggle } from "../molecules/ThemeToggle";
import { AppShell } from "../organisms/AppShell";
import { TimelineView } from "../organisms/TimelineView";
import { SummaryBar } from "../organisms/SummaryBar";
import { SearchFilterBar } from "../organisms/SearchFilterBar";
import { SmartInputBox } from "../organisms/SmartInputBox";
import { ShowcaseServicesProvider } from "./showcaseServices.tsx";
import type { SmartInputState } from "../viewModels/useSmartInput";
import { ThemeProvider } from "../theme/ThemeProvider";
import { createMemoryThemeStorage } from "../../adapters/themeStorage";

/**
 * Interactive demo components for the Storybook registry.
 *
 * Each is a small stateful wrapper that makes a story live (toggles,
 * open/close, typed input). Pure presentation — no business logic.
 */

/** A no-op change handler for the read-only previews. */
const noop = () => {};

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

/** Interactive Checkbox states. */
export function CheckboxDemo() {
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

/** Interactive Radio group (3 options, one disabled). */
export function RadioDemo() {
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

/** Interactive Switch (on / off / disabled). */
export function SwitchDemo() {
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

/** Controlled SearchField, seeded with an initial query. */
export function SearchFieldDemo({ initial }: { initial: string }) {
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

/** Interactive Dropdown. */
export function DropdownDemo() {
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

/** Interactive SegmentedControl (3 options). */
export function SegmentedDemo() {
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

/** Modal story: a button that opens the dialog. */
export function ModalDemo() {
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

/** SlideOver story: a button that opens the right-side panel. */
export function SlideOverDemo() {
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

/** Focus-ring story for the Guidelines (interactive controls). */
export function FocusDemo() {
  const [checked, setChecked] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Focusable button</Button>
      <IconButton label="Close">
        <CheckIcon aria-hidden="true" className="h-5 w-5" />
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

/** A self-contained, wired SearchFilterBar (no-op callbacks). */
export function SearchFilterBarDemo() {
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

/** A self-contained, wired SmartInputBox (no-op callbacks). */
export function SmartInputBoxDemo() {
  return <SmartInputBox smartInput={smartInputState()} />;
}

/** AppShell width story (desktop / mobile toggle). */
export function AppShellWidthDemo() {
  const [narrow, setNarrow] = useState(false);
  const headerSlots = {
    summarySlot: <SummaryBar />,
    searchSlot: <SearchFilterBarDemo />,
    smartInputSlot: <SmartInputBoxDemo />,
    themeToggleSlot: <ThemeToggle />,
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setNarrow((v) => !v)}
        className="mb-3"
      >
        {narrow ? "Wide (desktop)" : "Narrow (mobile)"} — toggle width
      </Button>
      <div className={narrow ? "max-w-[22rem]" : "w-full"}>
        <ShowcaseServicesProvider scenario="populated">
          <ThemeProvider storage={createMemoryThemeStorage("light")}>
            <AppShell view="timeline" onViewChange={noop} {...headerSlots}>
              <TimelineView />
            </AppShell>
          </ThemeProvider>
        </ShowcaseServicesProvider>
      </div>
    </>
  );
}
