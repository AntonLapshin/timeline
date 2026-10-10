import type { FormEvent, RefObject } from "react";
import type { SmartInputState } from "../viewModels/useSmartInput";
import { Button } from "../atoms/Button";
import { Alert } from "../atoms/Alert";

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
 * parse fails. While a parse is in flight the input is disabled and the
 * button shows a spinner (the parse is a local round-trip to the backend's
 * deterministic parser). All parsing/guarding logic lives in
 * `src/core`; the view model performs the parse I/O and opens the wizard.
 */
export function SmartInputBox({ smartInput, inputRef }: SmartInputBoxProps) {
  const { text, parsing, error, setText, submit } = smartInput;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <div className="w-full" data-testid="smart-input">
      <form onSubmit={onSubmit} className="flex w-full items-center gap-2">
        <div className="min-w-0 flex-1 rounded-xl transition-shadow focus-within:shadow-glow">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Add event… e.g. "dentist next Tuesday 3pm"'
            aria-label="Add event"
            disabled={parsing}
            aria-busy={parsing}
            className="field-input"
          />
        </div>
        <Button
          type="submit"
          variant="accent"
          disabled={parsing || !text.trim()}
          aria-busy={parsing || undefined}
          className="shrink-0"
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
        </Button>
      </form>
      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}
    </div>
  );
}
