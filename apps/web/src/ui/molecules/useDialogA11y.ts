import { useEffect, useRef, type RefObject } from "react";

/** Selector for keyboard-focusable elements inside a dialog panel. */
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Shared a11y contract for dialog surfaces (Modal, SlideOver).
 *
 * While `open` is true:
 * - body scroll is locked,
 * - focus moves to the first focusable element inside the panel
 *   (or the panel itself, which carries `tabIndex={-1}`),
 * - Tab / Shift+Tab cycles within the panel (focus trap),
 * - Escape calls `onClose`.
 *
 * When the effect cleans up, focus returns to the element that was focused
 * before the dialog opened and the previous body overflow is restored.
 * Safe to call during SSR — it no-ops when `document` is unavailable.
 *
 * @param open Whether the dialog is currently visible.
 * @param onClose Called when Escape is pressed.
 * @param panelRef Ref to the dialog panel element.
 */
export function useDialogA11y(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement>,
): void {
  // Kept in a ref so the effect below only re-runs on open/close
  // transitions even when the parent passes an inline `onClose`.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The element focused before the dialog opened. Captured once per open
  // session: React StrictMode re-runs this effect on mount without
  // unmounting, so a naive capture would record the dialog's own initial
  // focus target instead of the real trigger.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const sessionActiveRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (typeof document === "undefined") return;

    if (!sessionActiveRef.current) {
      sessionActiveRef.current = true;
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    if (panel) {
      const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? panel).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const host = panelRef.current;
      if (!host) return;
      const focusables = Array.from(host.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled"),
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // Captured for the cleanup below (reading `panelRef.current` directly
    // in the cleanup is unsafe — the ref may have moved on by then).
    const panelAtOpen = panel;
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      // StrictMode re-runs effects on mount without detaching the panel —
      // only restore focus on a real close/unmount (panel detached).
      if (panelAtOpen && panelAtOpen.isConnected) return;
      sessionActiveRef.current = false;
      const prev = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (prev && prev.isConnected) prev.focus();
    };
  }, [open, panelRef]);
}
