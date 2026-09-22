import type { EventWizardState } from "../viewModels/useEventWizard";
import { WizardStepOne } from "./WizardStepOne";
import { WizardStepTwo } from "./WizardStepTwo";
import { WizardStepThree } from "./WizardStepThree";
import { Button } from "./Button";
import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";

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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 pt-16 backdrop-blur-[2px] dark:bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-label="Create or edit event"
    >
      <div className="w-full max-w-lg rounded-lg border border-slate-200/70 bg-white/95 p-6 shadow-2xl backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-900/95 dark:shadow-black/50">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-lg font-semibold tracking-tight text-transparent dark:from-slate-100 dark:to-slate-400">
            {editingEvent ? "Edit event" : "New event"}
          </h2>
          <Button
            variant="ghost"
            square
            onClick={close}
            aria-label="Close wizard"
          >
            <XMarkIcon aria-hidden className="h-4 w-4" />
          </Button>
        </div>

        <ol className="mb-5 flex flex-wrap items-center gap-2 text-xs font-medium leading-4">
          {STEP_TITLES.map((title, index) => {
            const stepNum = (index + 1) as 1 | 2 | 3;
            const active = stepNum === step;
            const done = stepNum < step;
            return (
              <li key={title} className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] leading-none shadow-sm ${
                    active
                      ? "bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-indigo-600/30"
                      : done
                        ? "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-emerald-600/25"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                  }`}
                >
                  {done ? <CheckIcon aria-hidden className="h-3 w-3" strokeWidth={3} /> : stepNum}
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
            className="btn-ghost px-4 py-2"
          >
            Back
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={next}
              disabled={!canNext}
              className="btn-primary px-4 py-2"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn bg-gradient-to-b from-emerald-500 to-emerald-700 px-4 py-2 text-white shadow-md shadow-emerald-600/25"
            >
              {saving ? "Saving…" : "Save event"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
