import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, CheckIcon } from "@heroicons/react/24/outline";

/** A single dropdown option. */
export interface DropdownOption {
  /** The value passed to `onChange` when picked. */
  value: string;
  /** The human-readable label. */
  label: string;
}

export interface DropdownProps {
  /** Accessible label for the trigger button (e.g. "Filter by priority"). */
  label: string;
  /** Placeholder shown when nothing is selected (e.g. "Priority"). */
  placeholder: string;
  /** The currently selected value (`""` / null = placeholder). */
  value: string | null;
  /** The available options. */
  options: DropdownOption[];
  /** Called with the picked value (`""` clears back to the placeholder). */
  onChange: (value: string | null) => void;
  /** Disables the trigger. */
  disabled?: boolean;
  /** Extra classes for the wrapper. */
  className?: string;
}

/**
 * Shared custom dropdown (replaces native `<select>`).
 *
 * The trigger keeps the chevron clear of the right border (`pr-9` + an
 * absolutely positioned icon at `right-3`), and the open panel is a styled
 * popover: rounded-xl border, shadow, padding, and tall 40px options —
 * none of which a native select popup can do.
 */
export function Dropdown({
  label,
  placeholder,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === (value ?? "")) ?? null;

  // Close on outside click / Escape-driven focus loss.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open ]);

  const pick = (next: string | null) => {
    onChange(next === "" ? null : next);
    setOpen(false);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex(Math.max(0, options.findIndex((o) => o.value === (value ?? ""))));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pick(options[activeIndex].value);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className="relative h-auto min-h-8 w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-9 text-left text-sm text-slate-700 shadow-sm transition-colors hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/30 sm:w-auto sm:min-w-28"
      >
        <span className={`block truncate ${selected ? "" : "text-slate-400 dark:text-slate-500"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-transform dark:text-slate-500 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          onKeyDown={onListKeyDown}
          className="absolute z-30 mt-1.5 max-h-64 w-full min-w-36 animate-[dropdown-pop-in_120ms_ease-out] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/50 sm:w-auto sm:min-w-full"
        >
          <li role="option" aria-selected={!selected} aria-label={placeholder}>
            <button
              type="button"
              onClick={() => pick(null)}
              onMouseEnter={() => setActiveIndex(-1)}
              className={`dropdown-option flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                !selected
                  ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {placeholder}
              {!selected && <CheckIcon aria-hidden className="h-4 w-4 shrink-0" />}
            </button>
          </li>
          {options.map((opt) => {
            const isSelected = selected?.value === opt.value;
            return (
              <li key={opt.value} role="option" aria-selected={isSelected} aria-label={opt.label}>
                <button
                  type="button"
                  onClick={() => pick(opt.value)}
                  onMouseEnter={() =>
                    setActiveIndex(options.findIndex((o) => o.value === opt.value))
                  }
                  className={`dropdown-option flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <CheckIcon aria-hidden className="h-4 w-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
