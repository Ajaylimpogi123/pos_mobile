import type { UseMutationResult } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { splitSaveError, type FieldErrors } from '@/hooks/forms/formErrors';
import { useConfirmAction } from '@/hooks/forms/useConfirmAction';
import { useFormFields } from '@/hooks/forms/useFormFields';
import { getErrorMessage } from '@/services/api';

export type RecordFormConfig<V extends object, F extends string, R extends { id: number }, C, U extends object> = {
  /** The saved record when editing; `undefined` when creating. */
  initial: R | undefined;
  toValues: (record?: R) => V;
  /** Client-side checks mirroring the contract rules. `body` is `null` when there are errors. */
  validate: (values: V, saved: R | null) => { body: C | null; errors: FieldErrors<F> };
  /** Only the fields that changed (PATCH is partial). */
  diff: (saved: R, body: C) => U;
  /** Request field names whose 422 messages show under an input. */
  fields: readonly F[];
  /** Which request field each form value feeds, so typing clears that field's error. */
  fieldOf: { [K in keyof V]: F };
  create?: UseMutationResult<R, unknown, C>;
  update?: UseMutationResult<R, unknown, { id: number; body: U }>;
  remove?: UseMutationResult<void, unknown, number>;
  /** After a successful create or update (not called when nothing changed). */
  onSaved: (record: R, changes: Partial<C> | U) => void;
  /** Nothing changed: e.g. just go back. Defaults to `onSaved` with no changes. */
  onUnchanged?: (record: R) => void;
  onDeleted?: () => void;
};

/**
 * The shared create / edit / delete form engine (no image step; the menu
 * forms add one in `useCatalogForm`).
 *
 * Save: client-side validation → POST (create) or PATCH with the changed
 * fields only (skipped when nothing changed) → `onSaved`.
 * Errors: 422 → under each field; 403 / 404 / 409 / 5xx / network → banner.
 * Delete: a confirm dialog; a failure (e.g. 409) closes it and shows the banner.
 */
export function useRecordForm<V extends object, F extends string, R extends { id: number }, C, U extends object>(
  config: RecordFormConfig<V, F, R, C, U>,
) {
  const fields = useFormFields<V, F>(() => config.toValues(config.initial), config.fieldOf);
  const [saved, setSaved] = useState<R | null>(config.initial ?? null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const deleteDialog = useConfirmAction(
    async () => {
      if (!saved || !config.remove) return;
      await config.remove.mutateAsync(saved.id);
      config.onDeleted?.();
    },
    (error) => setBannerError(getErrorMessage(error)),
  );

  const busy = submitting || deleteDialog.busy;

  async function submit() {
    if (inFlight.current || deleteDialog.busy) return;
    setBannerError(null);

    const { body, errors } = config.validate(fields.values, saved);
    if (!body) {
      fields.setFieldErrors(errors);
      return;
    }
    fields.setFieldErrors({});

    inFlight.current = true;
    try {
      if (!saved) {
        if (!config.create) return;
        setSubmitting(true);
        const created = await config.create.mutateAsync(body);
        setSaved(created);
        config.onSaved(created, body);
        return;
      }
      const changes = config.diff(saved, body);
      if (Object.keys(changes).length === 0 || !config.update) {
        (config.onUnchanged ?? ((record: R) => config.onSaved(record, changes)))(saved);
        return;
      }
      setSubmitting(true);
      const updated = await config.update.mutateAsync({ id: saved.id, body: changes });
      setSaved(updated);
      config.onSaved(updated, changes);
    } catch (error) {
      const split = splitSaveError(error, config.fields);
      fields.setFieldErrors(split.fieldErrors);
      setBannerError(split.banner);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function requestDelete() {
    setBannerError(null);
    deleteDialog.request();
  }

  return {
    values: fields.values,
    setField: fields.setField,
    fieldErrors: fields.fieldErrors,
    /** Show client-side errors outside Save (e.g. the printer form's Test print checks the host). */
    setFieldErrors: fields.setFieldErrors,
    bannerError,
    setBannerError,
    /** Editing an existing record. */
    isEdit: saved !== null,
    saved,
    /** Replace the saved copy (e.g. after a PIN change returned a fresh record). */
    setSaved,
    submitting,
    busy,
    submit: () => void submit(),
    deleteDialog: { ...deleteDialog, request: requestDelete },
  };
}
