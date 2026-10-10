import type { EventDraft, DraftErrors } from "../../core/eventWizard";
import { FormField } from "../atoms/FormField";
import { TextInput } from "../atoms/TextInput";
import { Textarea } from "../atoms/Textarea";
import { Checkbox } from "../atoms/Checkbox";

/** Props for the What/When step. */
export interface WizardStepOneProps {
  /** The current draft. */
  draft: EventDraft;
  /** The current step's validation errors. */
  errors: DraftErrors;
  /** Update one or more draft fields. */
  onChange: (patch: Partial<EventDraft>) => void;
}

/**
 * Step 1 of the event wizard: What/When.
 *
 * Captures the event title, notes, the date/time (or all-day), and the
 * timezone. Dumb component — it renders the draft and calls `onChange`; all
 * validation lives in `src/core/eventWizard`.
 */
export function WizardStepOne({
  draft,
  errors,
  onChange,
}: WizardStepOneProps) {
  return (
    <div className="space-y-4">
      <FormField
        label="Title"
        htmlFor="wizard-title"
        required
        error={errors.title}
      >
        <TextInput
          id="wizard-title"
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="What's the event?"
          error={errors.title}
        />
      </FormField>

      <FormField label="Notes" htmlFor="wizard-notes">
        <Textarea
          id="wizard-notes"
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Optional details"
          rows={2}
          className="resize-y"
        />
      </FormField>

      <Checkbox
        id="wizard-all-day"
        label="All day"
        checked={draft.allDay}
        onChange={(checked) => onChange({ allDay: checked })}
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" htmlFor="wizard-date" error={errors.date}>
          <input
            id="wizard-date"
            type="date"
            value={draft.date}
            onChange={(e) => onChange({ date: e.target.value })}
            aria-invalid={errors.date ? true : undefined}
            className="field-input"
          />
        </FormField>
        <FormField label="Time" htmlFor="wizard-time" error={errors.time}>
          <input
            id="wizard-time"
            type="time"
            value={draft.time}
            disabled={draft.allDay}
            onChange={(e) => onChange({ time: e.target.value })}
            aria-invalid={errors.time ? true : undefined}
            className="field-input"
          />
        </FormField>
      </div>

      <FormField label="Timezone" htmlFor="wizard-tz">
        <TextInput
          id="wizard-tz"
          value={draft.tz}
          onChange={(e) => onChange({ tz: e.target.value })}
          placeholder="e.g. Europe/Berlin"
        />
      </FormField>
    </div>
  );
}
