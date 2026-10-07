import { getErrorMessage, isApiValidationError } from '@/services/api';

export type FieldErrors<F extends string> = Partial<Record<F, string>>;

/**
 * Splits a failed save into field errors and a banner message.
 * - 422: the first message of each known field goes under that field. When
 *   no known field matched, the 422 `message` goes to the banner instead,
 *   so it is never lost.
 * - Anything else (403, 404, 409, 5xx, network, timeout): banner only.
 */
export function splitSaveError<F extends string>(
  error: unknown,
  fields: readonly F[],
): { fieldErrors: FieldErrors<F>; banner: string | null } {
  if (isApiValidationError(error)) {
    const fieldErrors: FieldErrors<F> = {};
    for (const field of fields) {
      const message = error.firstError(field);
      if (message) fieldErrors[field] = message;
    }
    return { fieldErrors, banner: Object.keys(fieldErrors).length === 0 ? error.message : null };
  }
  return { fieldErrors: {}, banner: getErrorMessage(error) };
}

/** Trimmed text, or `null` when blank (nullable string fields). */
export function nullIfBlank(text: string): string | null {
  const value = text.trim();
  return value === '' ? null : value;
}

/**
 * A light email shape check before sending (the server's `email` rule is the
 * real check): something@something.tld, no spaces.
 */
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}
