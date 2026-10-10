import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "./useDialogA11y";

export interface ModalProps {
  /** Whether the dialog is visible. Renders null when false. */
  open: boolean;
  /** Called on backdrop click or Escape. */
  onClose: () => void;
  /** ID of the element labelling the dialog (aria-labelledby). */
  labelledBy: string;
  /** ID of the element describing the dialog (aria-describedby). */
  describedBy?: string;
  /** Dialog content. */
  children: ReactNode;
  /** Widen the panel to `sm:max-w-2xl` instead of `sm:max-w-lg`. */
  wide?: boolean;
}

/**
 * Accessible modal dialog.
 *
 * Renders nothing when closed; when open, portals a backdrop plus a centered
 * panel into `document.body`. The panel slides up as a bottom sheet on mobile
 * (`animate-sheet-up`) and pops in on `sm:` and up (`animate-pop`). Focus
 * management, Escape, the Tab trap, and body scroll-lock all come from
 * {@link useDialogA11y}.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  children,
  wide = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, onClose, panelRef);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="animate-fade fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-[2px]"
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          className={`card pointer-events-auto max-h-[92dvh] w-full animate-sheet-up overflow-y-auto rounded-t-3xl p-5 shadow-popover sm:animate-pop sm:rounded-3xl sm:p-6 ${
            wide ? "sm:max-w-2xl" : "sm:max-w-lg"
          }`}
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
