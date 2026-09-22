import { CheckIcon } from "@heroicons/react/24/outline";

export interface CheckboxProps {
  /** Accessible label (rendered next to the box when provided). */
  label?: string;
  /** Whether the box is checked. */
  checked: boolean;
  /** Called with the next checked state. */
  onChange: (checked: boolean) => void;
  /** Disables the control. */
  disabled?: boolean;
  /** Optional id (auto-generated association when omitted). */
  id?: string;
  /** Extra classes for the wrapping label. */
  className?: string;
}

/**
 * A styled checkbox: rounded box, indigo-gradient checked state with a
 * heroicons check, focus-visible ring, dark-mode aware.
 *
 * Keeps a real (screen-reader-only) native input so keyboard, focus and
 * assistive tech behave like a standard checkbox.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  disabled = false,
  id,
  className = "",
}: CheckboxProps) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 text-sm leading-none text-slate-700 dark:text-slate-200 ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/50 peer-focus-visible:ring-offset-1 dark:peer-focus-visible:ring-offset-slate-900 ${
          checked
            ? "border-indigo-500 bg-gradient-to-b from-indigo-500 to-indigo-700 text-white dark:border-indigo-400 dark:from-indigo-500 dark:to-indigo-600"
            : "border-slate-300 bg-white text-transparent shadow-sm hover:border-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:hover:border-slate-500"
        }`}
      >
        <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
