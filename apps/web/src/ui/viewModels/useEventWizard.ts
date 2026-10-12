import { useCallback, useEffect, useMemo, useState } from "react";
import { useServices } from "../services/useServices";
import { useUrlBatchUpdate, useUrlState } from "../services/useUrlState";
import { EDIT_MODAL_PARAM, NEW_MODAL_PARAM } from "../services/urlParams";
import {
  emptyDraft,
  draftFromEvent,
  validateDraft,
  stepErrors,
  canGoNext,
  nextStep,
  prevStep,
  buildCreatePayload,
  buildUpdatePayload,
  type EventDraft,
  type WizardStep,
} from "../../core/eventWizard";
import type { DraftErrors } from "../../core/eventWizard";
import type { EventRead } from "../../core/eventTypes";

/** Optional callbacks accepted by the event-wizard view model. */
export interface EventWizardOptions {
  /**
   * Called after a successful save (create or update). The app uses it to
   * refresh the data views (timeline/calendar/summary/filters) without a
   * reload (issue #121).
   */
  onSaved?: () => void;
}

/** State shape produced by the event-wizard view model. */
export interface EventWizardState {
  /** Whether the wizard is open. */
  open: boolean;
  /** The event being edited, or null when creating. */
  editingEvent: EventRead | null;
  /** The current step (1-3). */
  step: WizardStep;
  /** The working draft. */
  draft: EventDraft;
  /** The current step's validation errors. */
  errors: DraftErrors;
  /** Whether the user may advance from the current step. */
  canNext: boolean;
  /** Whether a save is in flight. */
  saving: boolean;
  /** A human error message, or null when there is none. */
  error: string | null;
  /** Open the wizard to create a new event. */
  openCreate: () => void;
  /** Open the wizard to create a new event pre-filled from a parsed draft. */
  openCreateWithDraft: (draft: EventDraft) => void;
  /** Open the wizard to edit an existing event (pre-filled). */
  openEdit: (event: EventRead) => void;
  /** Close the wizard. */
  close: () => void;
  /** Advance to the next step. */
  next: () => void;
  /** Go back to the previous step. */
  back: () => void;
  /** Update one or more draft fields. */
  update: (patch: Partial<EventDraft>) => void;
  /** Save the event via the API (create or update). */
  save: () => Promise<void>;
}

/**
 * Thin view model for the create/edit event wizard (issue #39).
 *
 * No business logic here — it holds the draft/step UI state, delegates all
 * transitions, validation and payload building to the pure
 * `src/core/eventWizard`, and performs the create/update I/O through the
 * injected `apiClient`. Components render the resulting state.
 *
 * The modal's open state is deep-linked via `use-state-in-url`: `?new=true`
 * opens the create form, `?edit=<id>` opens the editor for that event, so
 * the modal is shareable and the back button closes it. Step/draft stay
 * local; on a fresh load with `?edit=<id>` the event is fetched to pre-fill
 * the draft.
 *
 * A successful save closes the wizard (no dead-end success state) and fires
 * the `onSaved` callback so the app can refresh its data views; a failed save
 * keeps the modal open with an error (issue #121). Esc also closes the wizard
 * while it is open.
 */
export function useEventWizard(options?: EventWizardOptions): EventWizardState {
  const { apiClient } = useServices();
  const { onSaved } = options ?? {};
  const [isNewOpen, setNewOpen, newUpdater] = useUrlState(NEW_MODAL_PARAM);
  const [editId, setEditId, editUpdater] = useUrlState(EDIT_MODAL_PARAM);
  const { batchUpdate } = useUrlBatchUpdate();
  const open = isNewOpen || editId !== 0;
  const [editingEvent, setEditingEvent] = useState<EventRead | null>(null);
  const [step, setStep] = useState<WizardStep>(1);
  const [draft, setDraft] = useState<EventDraft>(() => emptyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = useCallback(() => {
    setDraft(emptyDraft());
    setEditingEvent(null);
    setStep(1);
    setError(null);
    setNewOpen(true);
  }, [setNewOpen]);

  const openCreateWithDraft = useCallback(
    (next: EventDraft) => {
      setDraft(next);
      setEditingEvent(null);
      setStep(1);
      setError(null);
      setNewOpen(true);
    },
    [setNewOpen],
  );

  const openEdit = useCallback(
    (event: EventRead) => {
      setDraft(draftFromEvent(event));
      setEditingEvent(event);
      setStep(1);
      setError(null);
      setEditId(event.id);
    },
    [setEditId],
  );

  // Close via one history entry (not two param updates).
  const close = useCallback(() => {
    batchUpdate([newUpdater(false), editUpdater(0)]);
    setError(null);
  }, [batchUpdate, newUpdater, editUpdater]);

  // Deep link: a fresh load (or back/forward) with `?edit=<id>` fetches the
  // event so the editor has something to pre-fill. Skipped when the event is
  // already held locally (the `openEdit(event)` path sets both together).
  useEffect(() => {
    if (editId === 0) return;
    if (editingEvent && editingEvent.id === editId) return;
    let cancelled = false;
    setError(null);
    apiClient
      .getEvent(editId)
      .then((event) => {
        if (cancelled) return;
        setEditingEvent(event);
        setDraft(draftFromEvent(event));
        setStep(1);
      })
      .catch(() => {
        if (cancelled) return;
        // Stale link: close the modal rather than stranding it empty.
        setEditId(0);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, editId, editingEvent, setEditId]);

  const next = useCallback(() => {
    setStep((s) => nextStep(s));
  }, []);

  const back = useCallback(() => {
    setStep((s) => prevStep(s));
  }, []);

  const update = useCallback((patch: Partial<EventDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const errors = useMemo(() => stepErrors(step, draft), [step, draft]);
  const canNext = useMemo(() => canGoNext(step, draft), [step, draft]);

  const save = useCallback(async () => {
    if (Object.keys(validateDraft(draft)).length > 0) {
      setError("Please complete all required fields");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingEvent) {
        await apiClient.updateEvent(
          editingEvent.id,
          buildUpdatePayload(draft),
        );
      } else {
        await apiClient.createEvent(buildCreatePayload(draft));
      }
      // Success: close the modal (issue #121) and let the app refresh its
      // data views via the `onSaved` callback. A failed save keeps the modal
      // open with an error.
      close();
      onSaved?.();
    } catch {
      setError("Failed to save event");
    } finally {
      setSaving(false);
    }
  }, [apiClient, draft, editingEvent, close, onSaved]);

  // Esc closes the wizard while it is open (issue #121; same window-keydown
  // pattern as `useEventDrawer`).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return {
    open,
    editingEvent,
    step,
    draft,
    errors,
    canNext,
    saving,
    error,
    openCreate,
    openCreateWithDraft,
    openEdit,
    close,
    next,
    back,
    update,
    save,
  };
}
