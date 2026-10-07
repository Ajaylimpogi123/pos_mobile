import { getErrorMessage, isApiValidationError } from '@/services/api';

export { nullIfBlank, splitSaveError, type FieldErrors } from '@/hooks/forms/formErrors';

/** Message for a failed image upload: the 422 `image` message when there is one. */
export function imageErrorMessage(error: unknown): string {
  if (isApiValidationError(error)) return error.firstError('image') ?? error.message;
  return getErrorMessage(error);
}

/** Sort order: blank means 0; otherwise a whole number 0–65535 (contract rule). */
export const SORT_ORDER_MAX = 65535;
export const SORT_ORDER_MESSAGE = `Sort order must be a whole number from 0 to ${SORT_ORDER_MAX}.`;

export function parseSortOrder(text: string): number | null {
  const value = text.trim();
  if (value === '') return 0;
  if (!/^\d{1,5}$/.test(value)) return null;
  const number = Number(value);
  return number <= SORT_ORDER_MAX ? number : null;
}
