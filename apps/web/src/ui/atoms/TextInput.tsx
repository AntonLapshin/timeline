import { forwardRef, type InputHTMLAttributes } from "react";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Validation error message. Sets `aria-invalid="true"`; the message
   * itself is rendered by `FormField` and referenced via `aria-describedby`.
   */
  error?: string;
}

/**
 * Single-line text input using the shared `.field-input` treatment.
 *
 * Label/hint/error rendering belongs to `FormField` — wrap this control in
 * one so the label and `aria-describedby` wiring stay consistent.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ error, className = "", ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={`field-input ${className}`.trim()}
        {...rest}
      />
    );
  },
);
