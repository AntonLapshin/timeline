import type { EventDraft } from "../../core/eventWizard";
import { REMINDER_OFFSET_PRESETS } from "../../core/eventWizard";
import type { EventChannel, EventPriority } from "../../core/eventTypes";
import { EVENT_PRIORITIES, EVENT_CHANNELS } from "../../core/eventTypes";
import { Checkbox } from "./Checkbox";
import { SEGMENT_ACTIVE_CLASSES } from "./SegmentedControl";

/** Props for the Priority & Reminders step. */
export interface WizardStepThreeProps {
  /** The current draft. */
  draft: EventDraft;
  /** Update one or more draft fields. */
  onChange: (patch: Partial<EventDraft>) => void;
}

/** Human labels for each priority level. */
const PRIORITY_LABELS: Record<EventPriority, string> = {
  critical: "Critical",
  medium: "Medium",
  low: "Low",
};

/** Gradient dot preview per priority. */
const PRIORITY_DOT: Record<EventPriority, string> = {
  critical: "from-rose-400 to-red-600",
  medium: "from-amber-300 to-orange-500",
  low: "from-sky-300 to-indigo-400",
};

/** Human labels for each reminder channel. */
const CHANNEL_LABELS: Record<EventChannel, string> = {
  telegram: "Telegram",
  email: "Email",
};

/** Toggle a value in an array (used for channels and offsets). */
function toggleValue<T extends string>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/**
 * Step 3 of the event wizard: Priority & Reminders.
 *
 * Lets the user choose the priority (critical / medium / low) and the reminder
 * offsets/channels. Dumb component — it renders the draft and calls
 * `onChange`; the reminder-offset format is enforced in `src/core`.
 */
export function WizardStepThree({
  draft,
  onChange,
}: WizardStepThreeProps) {
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="field-label">
          Priority
        </legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {EVENT_PRIORITIES.map((priority) => {
            const selected = draft.priority === priority;
            return (
              <label
                key={priority}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm leading-none transition-colors ${
                  selected
                    ? `${SEGMENT_ACTIVE_CLASSES} shadow-md shadow-indigo-600/25`
                    : "border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                }`}
              >
                <input
                  type="radio"
                  name="wizard-priority"
                  value={priority}
                  checked={selected}
                  onChange={() => onChange({ priority })}
                  className="h-4 w-4 accent-indigo-600 dark:accent-indigo-400"
                />
                <span
                  aria-hidden
                  className={`h-3.5 w-3.5 shrink-0 rounded-full bg-gradient-to-br ${PRIORITY_DOT[priority]} shadow-sm ring-1 ring-white/50 dark:ring-white/20`}
                />
                {PRIORITY_LABELS[priority]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="field-label">
          Reminder channels
        </legend>
        <div className="mt-2 flex gap-3">
          {EVENT_CHANNELS.map((channel) => (
            <Checkbox
              key={channel}
              label={CHANNEL_LABELS[channel]}
              checked={draft.channels.includes(channel)}
              onChange={() =>
                onChange({ channels: toggleValue(draft.channels, channel) })
              }
              className="rounded-lg px-2 py-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="field-label">
          Reminders before
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {REMINDER_OFFSET_PRESETS.map((offset) => {
            const selected = draft.reminderOffsets.includes(offset);
            return (
              <label
                key={offset}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm leading-none transition-colors ${
                  selected
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm dark:border-indigo-400/50 dark:bg-indigo-400/10 dark:text-indigo-300"
                    : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
                }`}
              >
                <Checkbox
                  checked={selected}
                  onChange={() =>
                    onChange({
                      reminderOffsets: toggleValue(
                        draft.reminderOffsets,
                        offset,
                      ),
                    })
                  }
                />
                {offset}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
