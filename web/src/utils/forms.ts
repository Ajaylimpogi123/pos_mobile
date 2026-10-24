/**
 * Small helpers shared by the back-office forms: blank → `null`, the length
 * message, a light email check, and the 422 → field message mapping.
 */
import { getErrorMessage, isApiValidationError } from '@/services/api';

/** Field → its first message (a client check or the server's 422). */
export type FieldErrors = Record<string, string | undefined>;

/** Trimmed text, or `null` when blank (nullable contract fields). */
export function nullIfBlank(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

export function tooLong(limit: number): string {
  return `Use ${limit} characters or fewer.`;
}

/** A light shape check; the server's `email` rule decides. */
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

/** Contract: `sort_order` is an integer 0–65535. */
export const SORT_ORDER_MESSAGE = 'Enter a whole number from 0 to 65535.';

export function parseSortOrder(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= 65535 ? value : null;
}

/**
 * Splits a failed save into the messages shown under the fields (a 422's
 * `errors` for `fields`) and the banner (everything else: 403, 404, 409,
 * network, and 422 keys no field shows).
 */
export function splitSaveError(error: unknown, fields: readonly string[]): { fieldErrors: FieldErrors; banner: string | null } {
  if (!error) return { fieldErrors: {}, banner: null };
  if (!isApiValidationError(error)) return { fieldErrors: {}, banner: getErrorMessage(error) };
  const fieldErrors: FieldErrors = {};
  const unshown: string[] = [];
  for (const [field, messages] of Object.entries(error.errors)) {
    const message = messages[0];
    if (!message) continue;
    if (fields.includes(field)) fieldErrors[field] = message;
    else unshown.push(message);
  }
  const banner = unshown.length > 0 ? unshown.join(' ') : Object.keys(fieldErrors).length === 0 ? error.message : null;
  return { fieldErrors, banner };
}
