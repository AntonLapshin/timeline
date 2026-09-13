import type { EventDraft } from "../../core/eventWizard";
import { REMINDER_OFFSET_PRESETS } from "../../core/eventWizard";
import type { EventChannel, EventPriority } from "../../core/eventTypes";
import { EVENT_PRIORITIES, EVENT_CHANNELS } from "../../core/eventTypes";

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
        <legend className="block text-sm font-medium text-slate-700">
          Priority
        </legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {EVENT_PRIORITIES.map((priority) => (
            <label
              key={priority}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                draft.priority === priority
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              <input
                type="radio"
                name="wizard-priority"
                value={priority}
                checked={draft.priority === priority}
                onChange={() => onChange({ priority })}
                className="h-4 w-4"
              />
              {PRIORITY_LABELS[priority]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="block text-sm font-medium text-slate-700">
          Reminder channels
        </legend>
        <div className="mt-2 flex gap-3">
          {EVENT_CHANNELS.map((channel) => (
            <label
              key={channel}
              className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={draft.channels.includes(channel)}
                onChange={() =>
                  onChange({ channels: toggleValue(draft.channels, channel) })
                }
                className="h-4 w-4"
              />
              {CHANNEL_LABELS[channel]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="block text-sm font-medium text-slate-700">
          Reminders before
        </legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {REMINDER_OFFSET_PRESETS.map((offset) => (
            <label
              key={offset}
              className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={draft.reminderOffsets.includes(offset)}
                onChange={() =>
                  onChange({
                    reminderOffsets: toggleValue(
                      draft.reminderOffsets,
                      offset,
                    ),
                  })
                }
                className="h-4 w-4"
              />
              {offset}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
