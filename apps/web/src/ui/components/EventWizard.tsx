import type { EventWizardState } from "../viewModels/useEventWizard";
import { WizardStepOne } from "./WizardStepOne";
import { WizardStepTwo } from "./WizardStepTwo";
import { WizardStepThree } from "./WizardStepThree";

/** Step titles shown at the top of the wizard. */
const STEP_TITLES = ["What/When", "Recurrence", "Priority & Reminders"];

/** Props for the event wizard container. */
export interface EventWizardProps {
  /** The wizard view-model state. */
  wizard: EventWizardState;
}

/**
 * The 3-step create/edit event wizard (issue #39).
 *
 * A thin, dumb container: it renders the current step's component and the
 * navigation/save controls, calling back into the view-model actions. All
 * transitions, validation and payload building live in `src/core/eventWizard`;
 * the view model performs the create/update I/O.
 */
export function EventWizard({ wizard }: EventWizardProps) {
  const {
    step,
    draft,
    errors,
    canNext,
    saving,
    error,
    editingEvent,
    next,
    back,
    update,
    save,
    close,
  } = wizard;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-16 dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Create or edit event"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {editingEvent ? "Edit event" : "New event"}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close wizard"
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <ol className="mb-5 flex flex-wrap items-center gap-2 text-xs font-medium">
          {STEP_TITLES.map((title, index) => {
            const stepNum = (index + 1) as 1 | 2 | 3;
            const active = stepNum === step;
            const done = stepNum < step;
            return (
              <li key={title} className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                    active
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : done
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                  }`}
                >
                  {done ? "✓" : stepNum}
                </span>
                <span
                  className={active ? "text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}
                >
                  {title}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mb-6">
          {step === 1 && (
            <WizardStepOne draft={draft} errors={errors} onChange={update} />
          )}
          {step === 2 && (
            <WizardStepTwo draft={draft} errors={errors} onChange={update} />
          )}
          {step === 3 && (
            <WizardStepThree draft={draft} onChange={update} />
          )}
        </div>

        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={step === 1}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-40"
          >
            Back
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={next}
              disabled={!canNext}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save event"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
