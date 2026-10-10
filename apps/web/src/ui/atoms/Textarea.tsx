import { forwardRef, type TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Validation error message. Sets `aria-invalid="true"`; the message
   * itself is rendered by `FormField` and referenced via `aria-describedby`.
   */
  error?: string;
}

/**
 * Multi-line textarea using the shared `.field-input` treatment.
 *
 * Label/hint/error rendering belongs to `FormField` — wrap this control in
 * one so the label and `aria-describedby` wiring stay consistent.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ error, className = "", rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={error ? true : undefined}
        className={`field-input ${className}`.trim()}
        {...rest}
      />
    );
  },
);
