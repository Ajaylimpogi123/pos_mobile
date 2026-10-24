/**
 * Validation of the shift forms, with the contract's limits
 * (docs/api-contract.md → Shifts & Reporting → Shift endpoints):
 * - opening float `0–100000000`, cash movement `1–100000000`,
 *   counted cash `0–1000000000` (integer centavos);
 * - a cash movement's reason is required, max 120; the close note max 255.
 * Pure functions: the typed text in, integer centavos (or a message) out.
 */
import { formatPeso, parsePesoInput } from '@pos/core/money';

/** Contract limits of the bodies. */
export const SHIFT_LIMITS = {
  maxOpeningFloatCents: 100_000_000,
  minCashMovementCents: 1,
  maxCashMovementCents: 100_000_000,
  maxReasonLength: 120,
  maxCountedCashCents: 1_000_000_000,
  maxCloseNoteLength: 255,
} as const;

export type Checked<T> = { value: T; error: null } | { value: null; error: string };

export const AMOUNT_FORMAT_MESSAGE = 'Enter an amount like 500 or 1,250.50.';

function money(text: string, options: { min: number; max: number; empty: string; tooHigh: string; tooLow: string }): Checked<number> {
  if (text.trim() === '') return { value: null, error: options.empty };
  const cents = parsePesoInput(text);
  if (cents === null) return { value: null, error: AMOUNT_FORMAT_MESSAGE };
  if (cents < options.min) return { value: null, error: options.tooLow };
  if (cents > options.max) return { value: null, error: options.tooHigh };
  return { value: cents, error: null };
}

/** The starting cash (₱0.00 is allowed). */
export function checkOpeningFloat(text: string): Checked<number> {
  return money(text, {
    min: 0,
    max: SHIFT_LIMITS.maxOpeningFloatCents,
    empty: 'Enter the starting cash (0 if the drawer is empty).',
    tooLow: AMOUNT_FORMAT_MESSAGE,
    tooHigh: `The starting cash can't be more than ${formatPeso(SHIFT_LIMITS.maxOpeningFloatCents)}.`,
  });
}

/** A cash in or out amount (at least ₱0.01). */
export function checkCashAmount(text: string): Checked<number> {
  return money(text, {
    min: SHIFT_LIMITS.minCashMovementCents,
    max: SHIFT_LIMITS.maxCashMovementCents,
    empty: 'Enter an amount.',
    tooLow: `The amount must be at least ${formatPeso(SHIFT_LIMITS.minCashMovementCents)}.`,
    tooHigh: `The amount can't be more than ${formatPeso(SHIFT_LIMITS.maxCashMovementCents)}.`,
  });
}

/** The reason of a cash movement: required, max 120 (trimmed). */
export function checkReason(text: string): Checked<string> {
  const reason = text.trim();
  if (reason === '') return { value: null, error: 'Enter a reason.' };
  if (reason.length > SHIFT_LIMITS.maxReasonLength) {
    return { value: null, error: `The reason can't be longer than ${SHIFT_LIMITS.maxReasonLength} characters.` };
  }
  return { value: reason, error: null };
}

/** The cash counted in the drawer at close (₱0.00 is allowed). */
export function checkCountedCash(text: string): Checked<number> {
  return money(text, {
    min: 0,
    max: SHIFT_LIMITS.maxCountedCashCents,
    empty: 'Enter the cash counted in the drawer.',
    tooLow: AMOUNT_FORMAT_MESSAGE,
    tooHigh: `The counted cash can't be more than ${formatPeso(SHIFT_LIMITS.maxCountedCashCents)}.`,
  });
}

/** The optional close note: trimmed, `null` when blank, max 255. */
export function checkCloseNote(text: string): Checked<string | null> {
  const note = text.trim();
  if (note.length > SHIFT_LIMITS.maxCloseNoteLength) {
    return { value: null, error: `The note can't be longer than ${SHIFT_LIMITS.maxCloseNoteLength} characters.` };
  }
  return { value: note === '' ? null : note, error: null } as Checked<string | null>;
}
