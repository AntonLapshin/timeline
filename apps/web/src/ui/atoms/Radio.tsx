import type { ReactNode } from "react";

export interface RadioProps {
  /** Radio group name (native `name` attribute). */
  name: string;
  /** The value reported to `onChange` when this option is selected. */
  value: string;
  /** Whether this option is selected (controlled). */
  checked: boolean;
  /** Called with `value` when the option is selected. */
  onChange: (value: string) => void;
  /** Primary label text. */
  label: ReactNode;
  /** Optional secondary description under the label. */
  description?: ReactNode;
  /** Disables the control. */
  disabled?: boolean;
  /** Extra classes for the wrapping label. */
  className?: string;
}

/**
 * A styled radio option with an optional description line.
 *
 * Keeps a real (screen-reader-only) native input so keyboard, focus and
 * assistive tech behave like a standard radio. The label shows the same
 * 2px focus outline as every other control via `has-[:focus-visible]`
 * (the outline can't target the `sr-only` input directly).
 *
 * Fully controlled: pass `checked` and update it in `onChange`.
 */
export function Radio({
  name,
  value,
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className = "",
}: RadioProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 dark:has-[:focus-visible]:outline-brand-400 ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${className}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          checked
            ? "border-brand-600 dark:border-brand-400"
            : "border-slate-300 bg-white hover:border-slate-400 dark:border-slate-600 dark:bg-ink-800 dark:hover:border-slate-500"
        }`}
      >
        {checked && (
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-b from-brand-500 to-brand-700 dark:from-brand-400 dark:to-brand-600" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
