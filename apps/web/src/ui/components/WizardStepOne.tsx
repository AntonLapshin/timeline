import type { EventDraft, DraftErrors } from "../../core/eventWizard";

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
      <div>
        <label className="block text-sm font-medium text-slate-700">
          Title
        </label>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="What's the event?"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {errors.title && (
          <p className="mt-1 text-xs text-red-600">{errors.title}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700">
          Notes
        </label>
        <textarea
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Optional details"
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="wizard-all-day"
          checked={draft.allDay}
          onChange={(e) => onChange({ allDay: e.target.checked })}
          className="h-4 w-4"
        />
        <label htmlFor="wizard-all-day" className="text-sm text-slate-700">
          All day
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Date
          </label>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => onChange({ date: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {errors.date && (
            <p className="mt-1 text-xs text-red-600">{errors.date}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Time
          </label>
          <input
            type="time"
            value={draft.time}
            disabled={draft.allDay}
            onChange={(e) => onChange({ time: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          />
          {errors.time && (
            <p className="mt-1 text-xs text-red-600">{errors.time}</p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700">
          Timezone
        </label>
        <input
          type="text"
          value={draft.tz}
          onChange={(e) => onChange({ tz: e.target.value })}
          placeholder="e.g. Europe/Berlin"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
