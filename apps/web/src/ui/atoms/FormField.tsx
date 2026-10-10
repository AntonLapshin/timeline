import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

export interface FormFieldProps {
  /** Field label (rendered in a `<label>` using `.field-label`). */
  label: ReactNode;
  /** `id` of the wrapped control — the label's `htmlFor` and the basis for the generated hint/error ids. */
  htmlFor: string;
  /** Optional hint rendered under the control (`.field-hint`). */
  hint?: ReactNode;
  /**
   * Optional validation error rendered under the control (`.field-error`).
   * Takes precedence over `hint`.
   */
  error?: string;
  /** The control (usually `TextInput` or `Textarea`). */
  children: ReactNode;
  /** Shows a required indicator (`*` + screen-reader "(required)"). */
  required?: boolean;
  /** Extra classes for the wrapping div. */
  className?: string;
}

/**
 * Label + control + hint/error stack for a form field.
 *
 * The single child control is cloned to add `aria-describedby` pointing at
 * the generated hint/error id (`<htmlFor>-hint` / `<htmlFor>-error`), so
 * assistive tech announces the right supporting text. Non-element children
 * are rendered untouched. The error message takes precedence over the hint.
 */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  required = false,
  className = "",
}: FormFieldProps) {
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-describedby": describedBy,
      })
    : children;

  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="field-label">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-0.5 text-red-500">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>
      {control}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
