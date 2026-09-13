import { useCallback, useRef, useState } from "react";
import { useServices } from "../services/useServices";
import {
  parsedToWizardDraft,
  type ParseResult,
} from "../../core/llmParse";
import type { EventDraft } from "../../core/eventWizard";

/** State shape produced by the smart-input view model. */
export interface SmartInputState {
  /** The current free-text value in the box. */
  text: string;
  /** Whether a parse request is in flight. */
  parsing: boolean;
  /** A human error message, or null when there is none. */
  error: string | null;
  /** Whether parsing is unavailable (e.g. LLM key absent). */
  unavailable: boolean;
  /** Update the free-text value. */
  setText: (text: string) => void;
  /** Parse the current text and, on success, hand the draft to `onParsed`. */
  submit: () => Promise<void>;
  /** Clear the input and any error. */
  clear: () => void;
}

/**
 * Thin view model for the smart-input "Add event…" box (issue #47).
 *
 * Holds the free-text value, parse-in-flight flag and inline error state, and
 * delegates the parse I/O to the injected `llmParser`. All parsing/guarding and
 * draft conversion logic lives in `src/core` (`llmParse`/`parseGuards`); this
 * view model only wires the result to the `onParsed` callback (which opens the
 * wizard pre-filled). No business logic here.
 *
 * @param onParsed  Called with a ready wizard draft after a successful parse.
 */
export function useSmartInput(
  onParsed: (draft: EventDraft) => void,
): SmartInputState {
  const { llmParser } = useServices();
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const onParsedRef = useRef(onParsed);
  onParsedRef.current = onParsed;

  const setTextValue = useCallback((value: string) => {
    setText(value);
    if (value.trim()) {
      // A new edit clears the previous result/error state.
      setError(null);
      setUnavailable(false);
    }
  }, []);

  const clear = useCallback(() => {
    setText("");
    setError(null);
    setUnavailable(false);
  }, []);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || parsing) {
      return;
    }
    setParsing(true);
    setError(null);
    setUnavailable(false);
    try {
      const result: ParseResult = await llmParser.parse(trimmed);
      if (!result.ok) {
        setError(result.error);
        setUnavailable(result.unavailable ?? false);
        return;
      }
      const converted = parsedToWizardDraft(result.draft);
      if (!converted.ok) {
        setError(
          "Couldn't turn that into an event. Try being more specific, or add it manually.",
        );
        return;
      }
      setText("");
      onParsedRef.current(converted.draft);
    } catch {
      // Network / API failure (other than the graceful 503 handled in core).
      setError(
        "Parsing is unavailable right now. You can still add the event manually.",
      );
      setUnavailable(true);
    } finally {
      setParsing(false);
    }
  }, [llmParser, text, parsing]);

  return {
    text,
    parsing,
    error,
    unavailable,
    setText: setTextValue,
    submit,
    clear,
  };
}
