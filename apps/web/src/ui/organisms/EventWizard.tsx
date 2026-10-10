import type { EventWizardState } from "../viewModels/useEventWizard";
import { WizardStepOne } from "./WizardStepOne";
import { WizardStepTwo } from "./WizardStepTwo";
import { WizardStepThree } from "./WizardStepThree";
import { Modal } from "../molecules/Modal";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Alert } from "../atoms/Alert";
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
 *
 * Built on the shared `Modal` molecule, which owns the focus trap, Escape
 * handling, backdrop click and body scroll-lock.
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
    <Modal
      open={wizard.open}
      onClose={close}
      labelledBy="event-wizard-title"
      wide
    >
      <div data-testid="event-wizard">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2
            id="event-wizard-title"
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100"
          >
            {editingEvent ? "Edit event" : "New event"}
          </h2>
          <IconButton label="Close wizard" onClick={close}>
            <XMarkIcon className="h-4 w-4" />
          </IconButton>
        </div>

        <ol
          key={step}
          className="mb-6 flex animate-fade items-center gap-1.5 text-xs font-medium"
          aria-label="Wizard steps"
        >
          {STEP_TITLES.map((title, index) => {
            const stepNum = (index + 1) as 1 | 2 | 3;
            const active = stepNum === step;
            const done = stepNum < step;
            return (
              <li
                key={title}
                aria-current={active ? "step" : undefined}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] leading-none shadow-sm ${
                    active
                      ? "animate-pulse-ring bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand-600/30"
                      : done
                        ? "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-emerald-600/25"
                        : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400"
                  }`}
                >
                  {done ? (
                    <CheckIcon aria-hidden className="h-3 w-3" strokeWidth={3} />
                  ) : (
                    stepNum
                  )}
                </span>
                <span
                  className={`truncate ${
                    active
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {title}
                </span>
                {stepNum < 3 && (
                  <span
                    aria-hidden
                    className={`mx-1 h-px min-w-3 flex-1 ${
                      done
                        ? "bg-emerald-400/60 dark:bg-emerald-400/40"
                        : "bg-slate-200 dark:bg-white/10"
                    }`}
                  />
                )}
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
          {step === 3 && <WizardStepThree draft={draft} onChange={update} />}
        </div>

        {error && (
          <Alert tone="error" className="mb-5">
            {error}
          </Alert>
        )}

        <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-between gap-3 border-t border-slate-200/70 bg-white/85 px-5 py-4 backdrop-blur-xl sm:-mx-6 sm:-mb-6 sm:px-6 dark:border-slate-700/50 dark:bg-ink-800/85">
          <Button
            type="button"
            variant="ghost"
            onClick={back}
            disabled={step === 1}
          >
            Back
          </Button>
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            Step {step} of 3
          </span>
          {step < 3 ? (
            <Button
              type="button"
              variant="primary"
              onClick={next}
              disabled={!canNext}
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              variant="accent"
              onClick={save}
              loading={saving}
            >
              {saving ? "Saving…" : "Save event"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
