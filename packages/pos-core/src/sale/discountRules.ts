/**
 * Discount rules (docs/api-contract.md → Core Sale → Discount rules): the
 * discount types and value limits, when a discount needs a manager's
 * approval, and the text ⇄ value conversions of the discount editors.
 * Integer arithmetic only.
 */
import type { SalePricing } from '@/sale/pricing';
import type { AuthUser, DiscountKind, DiscountType, PinUser, SaleDiscount } from '@/services/types';
import { formatPeso, parsePesoInput } from '@/utils/money';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/** The discount types of this phase, in the order the editors show them. */
export const DISCOUNT_TYPES: readonly { value: DiscountType; label: string }[] = [
  { value: 'promo', label: 'Promo' },
  { value: 'employee', label: 'Employee' },
  { value: 'manual', label: 'Manual' },
];

/** Contract limits of `value`: percent in basis points, amount in centavos. */
export const DISCOUNT_LIMITS = {
  percentMinBps: 1,
  percentMaxBps: 10_000,
  amountMinCents: 1,
  amountMaxCents: 1_000_000_000,
} as const;

const HUNDRED = BigInt(100);

/** The regular discounts only (line discounts + the order discount): SC/PWD never needs approval. */
type DiscountTotals = Pick<SalePricing, 'regular_discount_cents' | 'subtotal_cents'>;

/**
 * Whether the signed-in cashier needs a manager's approval for the sale's
 * regular discounts (`line_discounts_cents + order_discount`, never SC/PWD):
 * they are above 0 and either no `discount.apply`, or
 * `regular × 100 > subtotal_cents × role.max_discount_percent` (exact
 * integers). A UI hint: the server decides (and answers
 * 422 on `discount_authorization` when approval is missing).
 */
export function discountNeedsApproval(totals: DiscountTotals, user: AuthUser | null): boolean {
  if (totals.regular_discount_cents <= 0) return false;
  if (!user || !hasPermission(user, PERMISSIONS.discountApply)) return true;
  return !withinLimit(totals, user.role.max_discount_percent);
}

/** `regular_discount_cents × 100 ≤ subtotal_cents × maxPercent`. */
export function withinLimit(totals: DiscountTotals, maxPercent: number): boolean {
  return BigInt(totals.regular_discount_cents) * HUNDRED <= BigInt(totals.subtotal_cents) * BigInt(Math.max(0, Math.trunc(maxPercent)));
}

/** The people who can approve this discount: `can_approve_discounts` and a role limit that covers it. */
export function eligibleApprovers(approvers: readonly PinUser[], totals: DiscountTotals): PinUser[] {
  return approvers.filter((person) => person.can_approve_discounts && withinLimit(totals, person.max_discount_percent));
}

/** The server's wording for a discount above its base, e.g. "The discount can't be more than ₱80.00." */
export function discountTooLargeMessage(baseCents: number): string {
  return `The discount can't be more than ${formatPeso(baseCents)}.`;
}

/** "10%", "12.5%", "0.25%": basis points without trailing zeros. */
export function formatPercentValue(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return `${whole}%`;
  const decimals = fraction % 10 === 0 ? String(fraction / 10) : String(fraction).padStart(2, '0');
  return `${whole}.${decimals}%`;
}

/** "10%" or "₱10.00". */
export function formatDiscountValue(discount: Pick<SaleDiscount, 'kind' | 'value'>): string {
  return discount.kind === 'percent' ? formatPercentValue(discount.value) : formatPeso(discount.value);
}

export function discountTypeLabel(type: DiscountType): string {
  return DISCOUNT_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

/** "Promo · 10%". */
export function describeDiscount(discount: SaleDiscount): string {
  return `${discountTypeLabel(discount.type)} · ${formatDiscountValue(discount)}`;
}

/** Editable text for a discount value: 1250 bps → "12.5", 1000 centavos → "10.00". */
export function discountToInputText(discount: Pick<SaleDiscount, 'kind' | 'value'>): string {
  if (discount.kind === 'amount') {
    return `${Math.trunc(discount.value / 100)}.${String(discount.value % 100).padStart(2, '0')}`;
  }
  return formatPercentValue(discount.value).replace('%', '');
}

const PERCENT_INPUT = /^(\d{1,3})(?:\.(\d{0,2}))?$/;

export type ParsedDiscountValue = { value: number; error: null } | { value: null; error: string };

/**
 * What a cashier typed into a discount's value field, as the contract's
 * integer `value`: percent → basis points (1–10000, up to 2 decimals),
 * amount → centavos (₱0.01–₱10,000,000). Never goes through a float.
 */
export function parseDiscountInput(kind: DiscountKind, text: string): ParsedDiscountValue {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { value: null, error: kind === 'percent' ? 'Enter a percentage.' : 'Enter an amount.' };
  }

  if (kind === 'percent') {
    const match = PERCENT_INPUT.exec(trimmed.replace(/%$/, '').trim());
    if (!match) return { value: null, error: 'Enter a percentage like 10 or 12.5.' };
    const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    if (bps < DISCOUNT_LIMITS.percentMinBps || bps > DISCOUNT_LIMITS.percentMaxBps) {
      return { value: null, error: 'Enter a percentage from 0.01 to 100.' };
    }
    return { value: bps, error: null };
  }

  const cents = parsePesoInput(trimmed);
  if (cents === null) return { value: null, error: 'Enter an amount like 10 or 12.50.' };
  if (cents < DISCOUNT_LIMITS.amountMinCents) return { value: null, error: 'Enter an amount of at least ₱0.01.' };
  if (cents > DISCOUNT_LIMITS.amountMaxCents) {
    return { value: null, error: `The amount can't be more than ${formatPeso(DISCOUNT_LIMITS.amountMaxCents)}.` };
  }
  return { value: cents, error: null };
}

// ---------------------------------------------------------------------------
// Editor drafts (line discount, order discount)
// ---------------------------------------------------------------------------

/** A discount as the editor holds it: the value stays text until it is applied. */
export type DiscountDraft = {
  enabled: boolean;
  type: DiscountType;
  kind: DiscountKind;
  value: string;
};

export function discountDraftFrom(discount: SaleDiscount | null): DiscountDraft {
  if (!discount) return { enabled: false, type: 'promo', kind: 'percent', value: '' };
  return { enabled: true, type: discount.type, kind: discount.kind, value: discountToInputText(discount) };
}

export type ResolvedDiscount = { discount: SaleDiscount | null; error: null } | { discount: null; error: string };

/**
 * The discount a draft describes, checked against its base (a line's gross,
 * or the order's discount base `B`): an amount above the base is refused with
 * the server's wording. A percentage can never exceed its base.
 */
export function resolveDiscountDraft(draft: DiscountDraft, baseCents: number): ResolvedDiscount {
  if (!draft.enabled) return { discount: null, error: null };
  const parsed = parseDiscountInput(draft.kind, draft.value);
  if (parsed.error !== null) return { discount: null, error: parsed.error };
  if (draft.kind === 'amount' && parsed.value > baseCents) return { discount: null, error: discountTooLargeMessage(baseCents) };
  return { discount: { type: draft.type, kind: draft.kind, value: parsed.value }, error: null };
}
