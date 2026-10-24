/**
 * Senior Citizen / PWD Discount (docs/api-contract.md → Feature: Senior
 * Citizen / PWD Discount): the request rules, the no-double-discount rule,
 * the sheet's draft checks, and the labels the screens and the receipt use.
 *
 * - Any cashier can apply it, online or offline, with no approval.
 * - `items` mode: the cashier ticks the lines the SC/PWD consumes.
 *   `headcount` mode (a shared meal): `bill ÷ diners × persons`.
 * - No double discount: a marked line carries no other discount; an order
 *   with SC/PWD has no order discount; a shared meal has no discount at all.
 * - VAT exemption is optional per sale, and **off by default**.
 *
 * Pure functions; the amounts are in `@/sale/pricing`.
 */
import { SC_PWD_RATE_BPS, type PricingScPwd } from './pricing';
import type { SaleDiscount, ScPwdMode, ScPwdPerson, ScPwdPersonType, ScPwdRequest } from '../contract/types';
import { formatPercentValue } from './discountRules';

/** Contract limits: 1–10 persons, ID numbers max 30, diners up to 100. */
export const SC_PWD_LIMITS = { maxPersons: 10, idNoMax: 30, maxDiners: 100 } as const;

/** The contract's `id_no` rule. */
export const SC_PWD_ID_PATTERN = /^[A-Za-z0-9/ -]+$/;

/** Contract: the hint under the VAT exempt checkbox. */
export const VAT_EXEMPT_HINT = 'Remove the 12% VAT before the 20% discount';

/** Contract wording (422 on `items`): `items` mode with no line marked. */
export const TICK_ITEMS_MESSAGE = 'Tick the items for the senior citizen or PWD.';

/** Contract wording: SC/PWD over another discount. */
export const SC_PWD_CONFLICT_MESSAGE = "SC/PWD can't be combined with another discount.";

export const SC_PWD_PERSON_TYPES: readonly { value: ScPwdPersonType; label: string }[] = [
  { value: 'senior_citizen', label: 'Senior citizen' },
  { value: 'pwd', label: 'PWD' },
];

export const SC_PWD_MODES: readonly { value: ScPwdMode; label: string }[] = [
  { value: 'items', label: 'Their items' },
  { value: 'headcount', label: 'Shared meal' },
];

/** "Senior citizen" / "PWD". */
export function personTypeLabel(type: ScPwdPersonType): string {
  return SC_PWD_PERSON_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

/** "Their items" / "Shared meal". */
export function scPwdModeLabel(mode: ScPwdMode): string {
  return SC_PWD_MODES.find((entry) => entry.value === mode)?.label ?? mode;
}

/** "SC/PWD discount (20%)". */
export const SC_PWD_DISCOUNT_LABEL = `SC/PWD discount (${formatPercentValue(SC_PWD_RATE_BPS)})`;

/** "Shared by 4 diners, 1 SC/PWD" (headcount mode). */
export function sharedMealLine(diners: number, persons: number): string {
  return `Shared by ${diners} ${diners === 1 ? 'diner' : 'diners'}, ${persons} SC/PWD`;
}

/** "1 senior citizen · Their items", "2 SC/PWD · Shared by 4 diners, 2 SC/PWD". */
export function describeScPwd(scPwd: Pick<ScPwdRequest, 'mode' | 'persons' | 'diners'>): string {
  const count = scPwd.persons.length;
  let who = `${count} SC/PWD`;
  if (count === 1) who = personTypeLabel(scPwd.persons[0].type);
  if (scPwd.mode === 'headcount') return `${who} · ${sharedMealLine(scPwd.diners ?? count, count)}`;
  return `${who} · ${scPwdModeLabel(scPwd.mode)}`;
}

/** The pricing's view of a sale's SC/PWD. */
export function pricingScPwd(scPwd: ScPwdRequest | null): PricingScPwd | null {
  if (!scPwd) return null;
  return { mode: scPwd.mode, persons: scPwd.persons.length, diners: scPwd.diners, vat_exempt: scPwd.vat_exempt };
}

/** The `sc_pwd` of a request: exactly the contract's fields (`diners` is `null` in `items` mode). */
export function scPwdRequestOf(scPwd: ScPwdRequest | null): ScPwdRequest | null {
  if (!scPwd) return null;
  return {
    mode: scPwd.mode,
    persons: scPwd.persons.map((person) => ({ type: person.type, id_no: person.id_no })),
    diners: scPwd.mode === 'headcount' ? scPwd.diners : null,
    vat_exempt: scPwd.vat_exempt,
  };
}

// ---------------------------------------------------------------------------
// No double discount
// ---------------------------------------------------------------------------

type ConflictLine = { key: string; discount: SaleDiscount | null };

export type ScPwdConflicts = {
  /** The order discount must go (any SC/PWD). */
  orderDiscount: boolean;
  /** The lines whose discount must go: marked lines (`items`), or every line (`headcount`). */
  lineKeys: string[];
};

/** The discounts that SC/PWD in `mode` (with `markedKeys` in `items` mode) can't be combined with. */
export function scPwdConflicts(
  lines: readonly ConflictLine[],
  orderDiscount: SaleDiscount | null,
  mode: ScPwdMode,
  markedKeys: ReadonlySet<string>,
): ScPwdConflicts {
  return {
    orderDiscount: orderDiscount !== null,
    lineKeys: lines
      .filter((line) => line.discount !== null && (mode === 'headcount' || markedKeys.has(line.key)))
      .map((line) => line.key),
  };
}

export function hasConflicts(conflicts: ScPwdConflicts): boolean {
  return conflicts.orderDiscount || conflicts.lineKeys.length > 0;
}

/** "The order discount and 2 line discounts are removed." */
export function describeConflicts(conflicts: ScPwdConflicts): string {
  const parts: string[] = [];
  if (conflicts.orderDiscount) parts.push('the order discount');
  const count = conflicts.lineKeys.length;
  if (count > 0) parts.push(count === 1 ? '1 line discount' : `${count} line discounts`);
  const what = parts.join(' and ');
  return `SC/PWD can't be combined with another discount, so ${what} ${parts.length > 1 || count > 1 ? 'are' : 'is'} removed.`;
}

/** Whether a line can carry a line discount under the cart's SC/PWD. */
export function lineDiscountAllowed(scPwd: Pick<ScPwdRequest, 'mode'> | null, lineMarked: boolean): boolean {
  if (!scPwd) return true;
  return scPwd.mode === 'items' && !lineMarked;
}

// ---------------------------------------------------------------------------
// The sheet's draft
// ---------------------------------------------------------------------------

export type ScPwdPersonDraft = {
  /** A local key (people can be removed from the middle). */
  key: string;
  type: ScPwdPersonType;
  idNo: string;
};

export type ScPwdDraft = {
  mode: ScPwdMode;
  persons: ScPwdPersonDraft[];
  diners: number;
  /** Unticked by default for every new SC/PWD entry. */
  vatExempt: boolean;
  /** `items` mode: the ticked cart lines, by key. */
  markedKeys: string[];
};

export type ScPwdDraftErrors = {
  /** By person key. */
  persons: Record<string, string>;
  diners?: string;
  lines?: string;
};

export type ScPwdDraftResult =
  | { scPwd: ScPwdRequest; markedKeys: string[]; errors: null }
  | { scPwd: null; markedKeys: null; errors: ScPwdDraftErrors };

/** An ID number's problem (with the server's rules), or `null`. `taken`: it is already used by another person. */
export function idNoError(idNo: string, taken: boolean): string | null {
  const value = idNo.trim();
  if (value === '') return 'Enter the OSCA or PWD ID number.';
  if (value.length > SC_PWD_LIMITS.idNoMax) return `Use ${SC_PWD_LIMITS.idNoMax} characters or fewer.`;
  if (!SC_PWD_ID_PATTERN.test(value)) return 'Use only letters, numbers, spaces, dashes and slashes.';
  if (taken) return 'This ID number is already on this sale.';
  return null;
}

/**
 * Checks the sheet's draft with the contract's rules and builds the
 * `sc_pwd` it describes: every person has a distinct, valid ID number;
 * `items` mode has at least one ticked line (of `lineKeys`, the cart's
 * lines); `headcount` mode has diners from the persons count to 100.
 */
export function resolveScPwdDraft(draft: ScPwdDraft, lineKeys: readonly string[]): ScPwdDraftResult {
  const errors: ScPwdDraftErrors = { persons: {} };
  const seen = new Set<string>();
  for (const person of draft.persons) {
    const value = person.idNo.trim();
    const problem = idNoError(value, seen.has(value));
    if (problem) errors.persons[person.key] = problem;
    if (value !== '') seen.add(value);
  }

  const count = draft.persons.length;
  if (draft.mode === 'headcount') {
    if (!Number.isInteger(draft.diners) || draft.diners < Math.max(1, count)) {
      errors.diners = `At least ${Math.max(1, count)} ${Math.max(1, count) === 1 ? 'diner' : 'diners'}: one for each SC/PWD.`;
    } else if (draft.diners > SC_PWD_LIMITS.maxDiners) {
      errors.diners = `Up to ${SC_PWD_LIMITS.maxDiners} diners.`;
    }
  }

  const existing = new Set(lineKeys);
  const markedKeys = draft.mode === 'items' ? draft.markedKeys.filter((key) => existing.has(key)) : [];
  if (draft.mode === 'items' && markedKeys.length === 0) errors.lines = TICK_ITEMS_MESSAGE;

  if (count === 0 || count > SC_PWD_LIMITS.maxPersons || Object.keys(errors.persons).length > 0 || errors.diners || errors.lines) {
    return { scPwd: null, markedKeys: null, errors };
  }

  const persons: ScPwdPerson[] = draft.persons.map((person) => ({ type: person.type, id_no: person.idNo.trim() }));
  return {
    scPwd: {
      mode: draft.mode,
      persons,
      diners: draft.mode === 'headcount' ? draft.diners : null,
      vat_exempt: draft.vatExempt,
    },
    markedKeys,
    errors: null,
  };
}
