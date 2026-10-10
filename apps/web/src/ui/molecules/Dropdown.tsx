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
 * The trigger is `.field-input`-styled with the chevron clear of the right
 * border (`pr-9` + an absolutely positioned icon at `right-3`); the open
 * panel is a styled popover (`animate-pop`, `shadow-popover`, rounded-xl)
 * with tall 44px options and brand-tinted hover/selected states.
 *
 * Keyboard: ArrowUp/Down move through the rows (including the clear/
 * placeholder row at index -1), Home/End jump to the first/last row,
 * Enter picks, Escape closes and returns focus to the trigger.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
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
  }, [open]);

  const pick = (next: string | null) => {
    onChange(next === "" ? null : next);
    setOpen(false);
    // Focus stays on the trigger (the listbox is a single tab stop).
    triggerRef.current?.focus();
  };

  /** Id of the option row at `activeIndex` (`-1` = the clear/placeholder row). */
  const activeOptionId = (index: number) =>
    index < 0 ? `${listId}-opt-clear` : `${listId}-opt-${index}`;

  const openWithSelection = () => {
    setOpen(true);
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === (value ?? ""))));
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openWithSelection();
      }
      return;
    }
    // Open: the trigger owns all keyboard interaction (the option rows are
    // tabIndex=-1, so the listbox is a single tab stop with arrow-key nav).
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(-1);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const i = activeIndex;
      pick(i < 0 ? null : options[i].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  // Close when focus leaves the whole component (Tab past the trigger).
  const onRootBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setOpen(false);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(-1);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pick(options[activeIndex].value);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(null);
    }
  };

  const optionRowClass = (isSelected: boolean, isActive: boolean) =>
    `dropdown-option flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
      isSelected
        ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
        : isActive
          ? "bg-brand-50/60 text-slate-800 dark:bg-white/5 dark:text-slate-100"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
    }`;

  return (
    <div ref={rootRef} onBlur={onRootBlur} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? activeOptionId(activeIndex) : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openWithSelection())}
        onKeyDown={onTriggerKeyDown}
        className="field-input relative h-8 cursor-pointer pr-9 text-left sm:w-auto sm:min-w-28"
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
          className="animate-pop absolute z-30 mt-1.5 max-h-64 w-full min-w-36 overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-popover dark:border-slate-700/50 dark:bg-ink-800 sm:w-auto sm:min-w-full"
        >
          <li
            role="option"
            id={activeOptionId(-1)}
            aria-selected={!selected}
            aria-label={placeholder}
          >
            <button
              type="button"
              tabIndex={-1}
              onClick={() => pick(null)}
              onMouseEnter={() => setActiveIndex(-1)}
              className={optionRowClass(!selected, activeIndex === -1)}
            >
              {placeholder}
              {!selected && <CheckIcon aria-hidden className="h-4 w-4 shrink-0" />}
            </button>
          </li>
          {options.map((opt, index) => {
            const isSelected = selected?.value === opt.value;
            return (
              <li
                key={opt.value}
                role="option"
                id={activeOptionId(index)}
                aria-selected={isSelected}
                aria-label={opt.label}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => pick(opt.value)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={optionRowClass(isSelected, activeIndex === index)}
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
