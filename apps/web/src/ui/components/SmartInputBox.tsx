import type { FormEvent, RefObject } from "react";
import type { SmartInputState } from "../viewModels/useSmartInput";

/** Props for the smart-input box. */
export interface SmartInputBoxProps {
  /** The smart-input view-model state. */
  smartInput: SmartInputState;
  /** Optional ref attached to the text input (e.g. for the `/` shortcut). */
  inputRef?: RefObject<HTMLInputElement>;
}

/**
 * The smart-input "Add event…" box (issue #47).
 *
 * A thin, dumb component: it renders a free-text input and a submit button,
 * forwards the text to the view-model state, and shows an inline error when a
 * parse fails or is unavailable. While a parse is in flight the input is
 * disabled, the button shows a spinner, and a live status line sets
 * expectations (the API retries a flaky provider up to 5 times, so a slow
 * gateway can take a while). All parsing/guarding logic lives in
 * `src/core`; the view model performs the parse I/O and opens the wizard.
 */
export function SmartInputBox({ smartInput, inputRef }: SmartInputBoxProps) {
  const { text, parsing, error, unavailable, setText, submit } = smartInput;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="flex w-full items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Add event… e.g. "dentist next Tuesday 3pm"'
          aria-label="Add event"
          disabled={parsing}
          aria-busy={parsing}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm leading-5 text-slate-700 shadow-sm placeholder:text-slate-400 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/30"
        />
        <button
          type="submit"
          disabled={parsing || !text.trim()}
          className="btn-accent shrink-0 px-3 py-1.5"
        >
          {parsing && (
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 animate-spin"
              fill="none"
            >
              <circle
                cx="8"
                cy="8"
                r="6.5"
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="2"
              />
              <path
                d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
          {parsing ? "Parsing…" : "Add"}
        </button>
        {(error || unavailable) && (
          <p
            role="alert"
            className="w-full text-xs text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
      </form>
      {parsing && (
        <p
          role="status"
          className="mt-1 text-xs text-slate-500 dark:text-slate-400"
        >
          Contacting the AI — this can take a while when the provider is slow.
          Retrying automatically (up to 5 attempts); you can wait or add the
          event manually.
        </p>
      )}
    </div>
  );
}
