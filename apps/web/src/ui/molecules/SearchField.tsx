import { useId, type RefObject } from "react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";

export interface SearchFieldProps {
  /** The current query (controlled). */
  value: string;
  /** Called with the new query. */
  onChange: (value: string) => void;
  /** Placeholder text for the input. */
  placeholder?: string;
  /** Accessible label for the input (applied via aria-label). */
  label: string;
  /** Ref forwarded to the input element. */
  inputRef?: RefObject<HTMLInputElement>;
  /** Extra classes for the wrapper. */
  className?: string;
  /** Input id; generated when omitted. */
  id?: string;
}

/**
 * Search input with a leading icon and a clear button.
 *
 * The clear (X) button only appears when the field is non-empty; pressing
 * Escape while the field has content clears it and keeps focus in the input.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  inputRef,
  className = "",
  id,
}: SearchFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  const clear = () => {
    onChange("");
    inputRef?.current?.focus();
  };

  return (
    <div className={`relative ${className}`}>
      <MagnifyingGlassIcon
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
      />
      <input
        ref={inputRef}
        id={fieldId}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value !== "") {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        className="field-input pl-10 pr-10"
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-slate-300"
        >
          <XMarkIcon aria-hidden className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
