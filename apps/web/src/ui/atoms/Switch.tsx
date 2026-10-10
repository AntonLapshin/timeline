import type { ReactNode } from "react";

export interface SwitchProps {
  /** Whether the switch is on (controlled). */
  checked: boolean;
  /** Called with the next checked state. */
  onChange: (checked: boolean) => void;
  /** Accessible label rendered next to the track. */
  label: ReactNode;
  /** Disables the control. */
  disabled?: boolean;
  /** Extra classes for the wrapping label. */
  className?: string;
}

/**
 * A styled toggle switch built on a native checkbox.
 *
 * Keeps a real (screen-reader-only) native input so keyboard, focus and
 * assistive tech behave like a standard checkbox. The label shows the same
 * 2px focus outline as every other control via `has-[:focus-visible]`
 * (the outline can't target the `sr-only` input directly).
 *
 * Fully controlled: pass `checked` and update it in `onChange`.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  className = "",
}: SwitchProps) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2.5 rounded-xl p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 dark:has-[:focus-visible]:outline-brand-400 ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 ${
          checked
            ? "bg-gradient-to-r from-brand-500 to-brand-700 dark:from-brand-400 dark:to-brand-600"
            : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
    </label>
  );
}
