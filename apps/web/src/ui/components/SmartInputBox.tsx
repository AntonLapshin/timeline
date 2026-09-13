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
 * parse fails or is unavailable. All parsing/guarding logic lives in
 * `src/core`; the view model performs the parse I/O and opens the wizard.
 */
export function SmartInputBox({ smartInput, inputRef }: SmartInputBoxProps) {
  const { text, parsing, error, unavailable, setText, submit } = smartInput;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <form onSubmit={onSubmit} className="flex w-full items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='Add event… e.g. "dentist next Tuesday 3pm"'
        aria-label="Add event"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500"
      />
      <button
        type="submit"
        disabled={parsing || !text.trim()}
        className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
      >
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
  );
}
