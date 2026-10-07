import { useState } from 'react';

import type { FieldErrors } from '@/hooks/forms/formErrors';

/**
 * Form values plus per-field error messages. Editing a value clears the
 * error of the request field it feeds (`fieldOf`). Lives in the form screen,
 * above every layout switch, so rotating never loses input.
 */
export function useFormFields<V extends object, F extends string>(initial: () => V, fieldOf: { [K in keyof V]: F }) {
  const [values, setValues] = useState<V>(initial);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<F>>({});

  function setField<K extends keyof V>(key: K, value: V[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    const field = fieldOf[key];
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  return { values, setValues, setField, fieldErrors, setFieldErrors };
}
