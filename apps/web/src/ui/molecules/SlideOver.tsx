import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "./useDialogA11y";

export interface SlideOverProps {
  /** Whether the panel is visible. Renders null when false. */
  open: boolean;
  /** Called on backdrop click or Escape. */
  onClose: () => void;
  /** ID of the element labelling the dialog (aria-labelledby). */
  labelledBy: string;
  /** ID of the element describing the dialog (aria-describedby). */
  describedBy?: string;
  /** Panel content. */
  children: ReactNode;
}

/**
 * Accessible right-side slide-over drawer.
 *
 * Same a11y contract as {@link Modal} (focus trap, Escape, focus return,
 * body scroll-lock) via the shared {@link useDialogA11y} hook; the only
 * difference is the panel: a full-height right-anchored `<aside>` that
 * slides in with `animate-slide-in-right`.
 */
export function SlideOver({
  open,
  onClose,
  labelledBy,
  describedBy,
  children,
}: SlideOverProps) {
  const panelRef = useRef<HTMLElement>(null);
  useDialogA11y(open, onClose, panelRef);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="animate-fade fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-[2px]"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-50 w-full animate-slide-in-right overflow-y-auto border-l border-slate-200/70 bg-white/95 p-5 shadow-popover backdrop-blur-xl dark:border-slate-700/50 dark:bg-ink-900/95 sm:max-w-md"
      >
        {children}
      </aside>
    </>,
    document.body,
  );
}
