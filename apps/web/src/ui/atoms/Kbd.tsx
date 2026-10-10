import type { ReactNode } from "react";

export interface KbdProps {
  /** The key or key combination (e.g. `⌘K`, `Esc`). */
  children: ReactNode;
}

/**
 * Keyboard-key chip for shortcuts and hints.
 */
export function Kbd({ children }: KbdProps) {
  return (
    <kbd className="inline-flex min-h-6 items-center rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-slate-600 shadow-sm dark:border-slate-600 dark:bg-ink-800 dark:text-slate-300">
      {children}
    </kbd>
  );
}
