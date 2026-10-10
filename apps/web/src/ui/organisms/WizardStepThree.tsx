import type { EventDraft } from "../../core/eventWizard";
import { REMINDER_OFFSET_PRESETS } from "../../core/eventWizard";
import type { EventPriority } from "../../core/eventTypes";
import { EVENT_PRIORITIES, EVENT_CHANNELS } from "../../core/eventTypes";
import { CHANNEL_LABELS, toggleValue } from "../../core/utils";
import { Checkbox } from "../atoms/Checkbox";
import { Radio } from "../atoms/Radio";
import { PriorityDot } from "../atoms/PriorityDot";

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
        <legend className="field-label">Priority</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {EVENT_PRIORITIES.map((priority) => {
            const selected = draft.priority === priority;
            return (
              <Radio
                key={priority}
                name="wizard-priority"
                value={priority}
                checked={selected}
                onChange={(value) =>
                  onChange({ priority: value as EventPriority })
                }
                label={
                  <span className="flex items-center gap-2">
                    <PriorityDot priority={priority} size="sm" />
                    {PRIORITY_LABELS[priority]}
                  </span>
                }
                className={`items-center rounded-2xl border px-3 py-2.5 transition-[background-color,border-color,box-shadow,color] ${
                  selected
                    ? "border-brand-500/70 bg-brand-50/70 shadow-glow dark:border-brand-400/50 dark:bg-brand-500/10"
                    : "border-slate-300/80 bg-white shadow-sm hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600/60 dark:bg-ink-800 dark:hover:border-slate-500 dark:hover:bg-white/5"
                }`}
              />
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="field-label">Reminder channels</legend>
        <div className="mt-2 flex gap-3">
          {EVENT_CHANNELS.map((channel) => (
            <Checkbox
              key={channel}
              label={CHANNEL_LABELS[channel]}
              checked={draft.channels.includes(channel)}
              onChange={() =>
                onChange({ channels: toggleValue(draft.channels, channel) })
              }
              className="rounded-lg px-2 py-1 transition-colors hover:bg-slate-100 dark:hover:bg-white/5"
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="field-label">Reminders before</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {REMINDER_OFFSET_PRESETS.map((offset) => {
            const selected = draft.reminderOffsets.includes(offset);
            return (
              <label
                key={offset}
                className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm leading-none transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 dark:has-[:focus-visible]:outline-brand-400 ${
                  selected
                    ? "border-brand-500/70 bg-brand-50/70 text-brand-700 shadow-sm dark:border-brand-400/50 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-slate-300/80 bg-white text-slate-600 shadow-sm hover:border-slate-400 dark:border-slate-600/60 dark:bg-ink-800 dark:text-slate-300 dark:hover:border-slate-500"
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
