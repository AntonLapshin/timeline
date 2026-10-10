import type { EventDraft, DraftErrors } from "../../core/eventWizard";
import {
  RECURRENCE_CHOICES,
  type RecurrenceChoice,
} from "../../core/eventWizard";
import { FormField } from "../atoms/FormField";
import { TextInput } from "../atoms/TextInput";
import { Radio } from "../atoms/Radio";

/** Props for the Recurrence step. */
export interface WizardStepTwoProps {
  /** The current draft. */
  draft: EventDraft;
  /** The current step's validation errors. */
  errors: DraftErrors;
  /** Update one or more draft fields. */
  onChange: (patch: Partial<EventDraft>) => void;
}

/** Human labels for each recurrence choice. */
const RECURRENCE_LABELS: Record<RecurrenceChoice, string> = {
  none: "None (one-time)",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  custom: "Custom",
};

/**
 * Step 2 of the event wizard: Recurrence.
 *
 * Lets the user pick none / daily / weekly / monthly / quarterly / yearly /
 * custom, with a free-form RRULE input for the custom case. Dumb component —
 * it renders the draft and calls `onChange`; rule derivation lives in
 * `src/core/eventWizard`.
 */
export function WizardStepTwo({
  draft,
  errors,
  onChange,
}: WizardStepTwoProps) {
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="field-label">Recurrence</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {RECURRENCE_CHOICES.map((choice) => {
            const selected = draft.recurrence === choice;
            return (
              <Radio
                key={choice}
                name="wizard-recurrence"
                value={choice}
                checked={selected}
                onChange={(value) =>
                  onChange({ recurrence: value as RecurrenceChoice })
                }
                label={RECURRENCE_LABELS[choice]}
                className={`items-center rounded-xl border px-3 py-2.5 transition-[background-color,border-color,box-shadow,color] ${
                  selected
                    ? "border-brand-500/70 bg-brand-50/70 shadow-glow dark:border-brand-400/50 dark:bg-brand-500/10"
                    : "border-slate-300/80 bg-white shadow-sm hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600/60 dark:bg-ink-800 dark:hover:border-slate-500 dark:hover:bg-white/5"
                }`}
              />
            );
          })}
        </div>
      </fieldset>

      {draft.recurrence === "custom" && (
        <FormField
          label="Custom rule (RFC 5545)"
          htmlFor="wizard-custom-rrule"
          error={errors.customRrule}
        >
          <TextInput
            id="wizard-custom-rrule"
            value={draft.customRrule}
            onChange={(e) => onChange({ customRrule: e.target.value })}
            placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,WE"
            error={errors.customRrule}
          />
        </FormField>
      )}
    </div>
  );
}
