import { useCallback, useRef, useState } from "react";
import { useServices } from "../services/useServices";
import {
  parsedToWizardDraft,
  type ParseResult,
} from "../../core/quickParse";
import type { EventDraft } from "../../core/eventWizard";

/** State shape produced by the smart-input view model. */
export interface SmartInputState {
  /** The current free-text value in the box. */
  text: string;
  /** Whether a parse request is in flight. */
  parsing: boolean;
  /** A human error message, or null when there is none. */
  error: string | null;
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
 * delegates the parse I/O to the injected `quickParser` (the deterministic
 * `POST /api/events/quick-parse` client). All parsing/guarding and draft
 * conversion logic lives in `src/core` (`quickParse`/`parseGuards`); this
 * view model only wires the result to the `onParsed` callback (which opens the
 * wizard pre-filled). No business logic here.
 *
 * @param onParsed  Called with a ready wizard draft after a successful parse.
 */
export function useSmartInput(
  onParsed: (draft: EventDraft) => void,
): SmartInputState {
  const { quickParser } = useServices();
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onParsedRef = useRef(onParsed);
  onParsedRef.current = onParsed;

  const setTextValue = useCallback((value: string) => {
    setText(value);
    if (value.trim()) {
      // A new edit clears the previous result/error state.
      setError(null);
    }
  }, []);

  const clear = useCallback(() => {
    setText("");
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || parsing) {
      return;
    }
    setParsing(true);
    setError(null);
    try {
      const result: ParseResult = await quickParser.parse(trimmed);
      if (!result.ok) {
        setError(result.error);
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
      // Only truly unexpected errors land here: `quickParse` maps every
      // HTTP/network failure to a typed result, so a throw means a bug or an
      // exotic failure — fall back to the generic message.
      setError(
        "Something went wrong while parsing. You can still add the event manually.",
      );
    } finally {
      setParsing(false);
    }
  }, [quickParser, text, parsing]);

  return {
    text,
    parsing,
    error,
    setText: setTextValue,
    submit,
    clear,
  };
}
