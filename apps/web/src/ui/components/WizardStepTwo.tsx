import type { EventDraft, DraftErrors } from "../../core/eventWizard";
import {
  RECURRENCE_CHOICES,
  type RecurrenceChoice,
} from "../../core/eventWizard";

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
        <legend className="field-label">
          Recurrence
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {RECURRENCE_CHOICES.map((choice) => {
            const selected = draft.recurrence === choice;
            return (
              <label
                key={choice}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm leading-5 transition-all duration-150 ${
                  selected
                    ? "border-indigo-500 bg-gradient-to-b from-indigo-500 to-indigo-700 text-white shadow-md shadow-indigo-600/25 dark:border-indigo-400 dark:from-indigo-500 dark:to-indigo-600"
                    : "border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                }`}
              >
                <input
                  type="radio"
                  name="wizard-recurrence"
                  value={choice}
                  checked={selected}
                  onChange={() => onChange({ recurrence: choice })}
                  className="h-4 w-4 accent-indigo-600 dark:accent-indigo-400"
                />
                {RECURRENCE_LABELS[choice]}
              </label>
            );
          })}
        </div>
      </fieldset>

      {draft.recurrence === "custom" && (
        <div>
          <label className="field-label">
            Custom rule (RFC 5545)
          </label>
          <input
            type="text"
            value={draft.customRrule}
            onChange={(e) => onChange({ customRrule: e.target.value })}
            placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,WE"
            className="field-input mt-1"
          />
          {errors.customRrule && (
            <p className="mt-1 text-xs leading-4 text-red-600 dark:text-red-400">{errors.customRrule}</p>
          )}
        </div>
      )}
    </div>
  );
}
