/**
 * Refund amounts (docs/api-contract.md → Voids & Refunds (Phase 7) → Refund
 * amounts). The server is authoritative; the app runs the **same** formula
 * to show the amount and to send `client_refund_cents` (the checksum, which
 * must match exactly: there is no ±1).
 *
 * For a line with `qty = n`, `line_total_cents = T`, of which `p` units were
 * already refunded, refunding `k` more gives
 *   `amount = rhu(T × (p + k), n) − rhu(T × p, n)`.
 * The rounding is cumulative, so refunding a line in several parts always
 * adds up to exactly `T`, and a full refund returns exactly `total_cents`.
 *
 * VAT is split once per refund (as in *Sale pricing* step 8): `V` = Σ over
 * the vatable lines of their **taxable part**, refunded with the same
 * cumulative formula on `τ_i = line_total_i − X_i` (Senior Citizen / PWD
 * Discount → Refunds): `rhu(τ × (p + k), n) − rhu(τ × p, n)`. `X_i` is the
 * line's SC/PWD exempt part (`E_i − R_i − S_i` when the sale's
 * `sc_pwd.vat_exempt` is true, else 0), so without SC/PWD `τ = line_total`.
 * Each line's taxable part is clamped to its refund amount (Q-024 item 1).
 * `vatable_sales = rhu(V × 10000, 11200)`, `vat = V − vatable_sales`, and the
 * rest of the refund is VAT-exempt (`vat_exempt = Σ amount − V`).
 *
 * Money goes back the way it was paid: per method, the refunds so far plus
 * this one can't exceed what that method paid (the stored `amount_cents`, so
 * cash is net of change). The default split is cash first, then GCash.
 *
 * Intermediate products can exceed 2^53, so the maths runs on `BigInt`;
 * only the results become numbers again. No floats anywhere.
 */
import { rhu, VAT_RATE_BPS } from './pricing';
import type {
  Order,
  OrderItem,
  PaymentMethod,
  PrintableOrder,
  RefundCreateRequest,
  RefundItemRequest,
  RefundPaymentRequest,
  ReversalAuthorization,
} from '../contract/types';
import { formatPeso, parsePesoInput } from '../money';

const ZERO = BigInt(0);
const BPS = BigInt(10_000);

/** Contract: `reason` is `required|string|max:255` (voids and refunds). */
export const REVERSAL_REASON_MAX = 255;

/** Contract: `payments.*.reference_no` for GCash: `required`, `max:64`, `[A-Za-z0-9-]`. */
export const REFUND_REFERENCE_MAX = 64;
const REFERENCE_PATTERN = /^[A-Za-z0-9-]+$/;

function toBig(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer, got ${String(value)}`);
  }
  return BigInt(value);
}

/**
 * The amount of refunding `refundQty` more units of a line (see the module
 * notes): `rhu(T × (p + k), n) − rhu(T × p, n)`.
 */
export function refundLineAmount(lineTotalCents: number, qty: number, refundedQty: number, refundQty: number): number {
  const total = toBig(lineTotalCents, 'line_total_cents');
  const n = toBig(qty, 'qty');
  const p = toBig(refundedQty, 'refunded_qty');
  const k = toBig(refundQty, 'refund qty');
  if (n === ZERO) throw new RangeError('A line needs a quantity of at least 1.');
  if (p + k > n) throw new RangeError(`Only ${String(n - p)} left to refund.`);
  return Number(rhu(total * (p + k), n) - rhu(total * p, n));
}

/** Units of a line still refundable (never below 0). */
export function remainingQty(item: Pick<OrderItem, 'qty' | 'refunded_qty'>): number {
  return Math.max(0, item.qty - (item.refunded_qty ?? 0));
}

/** How many units of each line to refund, by `items[].id`. Missing or 0 = not refunded. */
export type RefundSelection = Readonly<Record<number, number>>;

export type PricedRefundLine = {
  item: OrderItem;
  qty: number;
  amount_cents: number;
};

export type RefundPricing = {
  /** The lines being refunded (qty > 0), in the order's line order. */
  lines: PricedRefundLine[];
  amount_cents: number;
  vatable_sales_cents: number;
  vat_amount_cents: number;
  vat_exempt_sales_cents: number;
  /** Σ qty. */
  units: number;
  /**
   * Dine-in Tables & Tabs §E: the order's service charge `S`, returned only by
   * the refund that leaves nothing refundable (included in `amount_cents`,
   * outside the VAT split); 0 otherwise.
   */
  service_charge_cents: number;
};

/** The selection refunds every unit still refundable (the last refund of the order). */
export function refundsEverythingLeft(items: readonly OrderItem[], selection: RefundSelection): boolean {
  const clamped = clampSelection(items, selection);
  return Object.keys(clamped).length > 0 && items.every((item) => (clamped[item.id] ?? 0) === remainingQty(item));
}

/** A selection limited to the order's lines and to each line's remaining quantity. */
export function clampSelection(items: readonly OrderItem[], selection: RefundSelection): Record<number, number> {
  const clamped: Record<number, number> = {};
  for (const item of items) {
    const wanted = Math.trunc(selection[item.id] ?? 0);
    const qty = Math.max(0, Math.min(remainingQty(item), wanted));
    if (qty > 0) clamped[item.id] = qty;
  }
  return clamped;
}

/** **Refund everything**: every line at its remaining quantity. */
export function fullRefundSelection(items: readonly OrderItem[]): Record<number, number> {
  const selection: Record<number, number> = {};
  for (const item of items) {
    const qty = remainingQty(item);
    if (qty > 0) selection[item.id] = qty;
  }
  return selection;
}

/**
 * A line's taxable part `τ = line_total − X` (Senior Citizen / PWD Discount →
 * Refunds). `X = E − R − S` when the sale's SC/PWD is VAT-exempt, else 0. A
 * line stored before SC/PWD has no such fields: `X = 0`. Never below 0.
 */
export function taxablePartCents(
  item: Pick<OrderItem, 'line_total_cents'> & Partial<Pick<OrderItem, 'sc_pwd_eligible_cents' | 'sc_pwd_vat_relief_cents' | 'sc_pwd_discount_cents'>>,
  scPwdVatExempt: boolean,
): number {
  if (!scPwdVatExempt) return item.line_total_cents;
  const exempt = (item.sc_pwd_eligible_cents ?? 0) - (item.sc_pwd_vat_relief_cents ?? 0) - (item.sc_pwd_discount_cents ?? 0);
  return Math.max(0, item.line_total_cents - Math.max(0, exempt));
}

/**
 * The taxable part of refunding `k` more units of a line (Q-024 item 1, as the
 * server's `RefundCalculator::taxableAmount`): the cumulative formula on `τ`,
 * clamped to the line's refund amount so its exempt part is never negative:
 * `v = min(amount, rhu(τ × (p + k), n) − rhu(τ × p, n))`.
 * E.g. `T = 2`, `τ = 1`, `n = 3`, the 2nd unit: amount 0, taxable 1 → 0.
 */
export function refundTaxableAmount(
  amountCents: number,
  taxableCents: number,
  qty: number,
  refundedQty: number,
  refundQty: number,
): number {
  return Math.min(amountCents, refundLineAmount(taxableCents, qty, refundedQty, refundQty));
}

/**
 * The refund's amount and VAT split for a selection (see the module notes).
 * `scPwdVatExempt`: the sale's `sc_pwd?.vat_exempt` (its SC/PWD part is then VAT-exempt).
 * `serviceChargeCents`: the order's `service_charge_cents` (Dine-in §E): a partial
 * refund doesn't return it; the refund that leaves nothing refundable does.
 */
export function priceRefund(
  items: readonly OrderItem[],
  selection: RefundSelection,
  scPwdVatExempt = false,
  vatRateBps: number = VAT_RATE_BPS,
  serviceChargeCents = 0,
): RefundPricing {
  const clamped = clampSelection(items, selection);
  const lines: PricedRefundLine[] = [];
  let amountTotal = ZERO;
  let vatable = ZERO;
  let units = 0;
  for (const item of items) {
    const qty = clamped[item.id] ?? 0;
    if (qty === 0) continue;
    const refunded = item.refunded_qty ?? 0;
    const amount = refundLineAmount(item.line_total_cents, item.qty, refunded, qty);
    lines.push({ item, qty, amount_cents: amount });
    units += qty;
    amountTotal += BigInt(amount);
    if (item.is_vatable) vatable += BigInt(refundTaxableAmount(amount, taxablePartCents(item, scPwdVatExempt), item.qty, refunded, qty));
  }
  const vatableSales = rhu(vatable * BPS, BPS + toBig(vatRateBps, 'vatRateBps'));
  const serviceCharge = serviceChargeCents > 0 && refundsEverythingLeft(items, selection) ? serviceChargeCents : 0;
  return {
    lines,
    amount_cents: Number(amountTotal) + serviceCharge,
    vatable_sales_cents: Number(vatableSales),
    vat_amount_cents: Number(vatable - vatableSales),
    vat_exempt_sales_cents: Number(amountTotal - vatable),
    units,
    service_charge_cents: serviceCharge,
  };
}

/** Amounts per payment method. */
export type MethodAmounts = Record<PaymentMethod, number>;

/** What each method paid: Σ the stored `amount_cents` (cash is net of change). */
export function paidByMethod(order: Pick<Order, 'payments'>): MethodAmounts {
  const paid: MethodAmounts = { cash: 0, gcash: 0 };
  for (const payment of order.payments) paid[payment.method] += payment.amount_cents;
  return paid;
}

/** What each method has refunded so far (Σ `refunds[].payments`). */
export function refundedByMethod(order: Pick<Order, 'refunds'>): MethodAmounts {
  const refunded: MethodAmounts = { cash: 0, gcash: 0 };
  for (const refund of order.refunds ?? []) {
    for (const payment of refund.payments) refunded[payment.method] += payment.amount_cents;
  }
  return refunded;
}

/** What each method still has to refund: paid − refunded so far (never below 0). */
export function refundableByMethod(order: Pick<Order, 'payments' | 'refunds'>): MethodAmounts {
  const paid = paidByMethod(order);
  const refunded = refundedByMethod(order);
  return { cash: Math.max(0, paid.cash - refunded.cash), gcash: Math.max(0, paid.gcash - refunded.gcash) };
}

/** The default split: cash first, up to the cash still refundable, then GCash. */
export function defaultRefundSplit(amountCents: number, refundable: MethodAmounts): MethodAmounts {
  const cash = Math.min(amountCents, refundable.cash);
  return { cash, gcash: amountCents - cash };
}

/** The server's wording: "The refund must add up to ₱33.69." */
export function refundTotalMessage(amountCents: number): string {
  return `The refund must add up to ${formatPeso(amountCents)}.`;
}

/** The server's wording: "Only ₱157.00 paid by cash is left to refund." (or GCash). */
export function methodLimitMessage(method: PaymentMethod, leftCents: number): string {
  return `Only ${formatPeso(leftCents)} paid by ${method === 'gcash' ? 'GCash' : 'cash'} is left to refund.`;
}

/** The refund's payment split as typed (amounts stay text until submitted). */
export type RefundSplitDraft = {
  cash: string;
  gcash: string;
  /** The reference of the GCash transfer back to the customer. */
  reference: string;
};

export type RefundSplitErrors = {
  cash?: string;
  gcash?: string;
  reference?: string;
  /** The split doesn't add up to the refund amount. */
  general?: string;
};

export type RefundSplitResult = {
  cashCents: number;
  gcashCents: number;
  /** Cash first, then GCash; only methods with an amount. `null` while something must be fixed. */
  payments: RefundPaymentRequest[] | null;
  errors: RefundSplitErrors | null;
};

function amountOf(text: string): number | null {
  if (text.trim() === '') return 0;
  return parsePesoInput(text);
}

const AMOUNT_FORMAT_MESSAGE = 'Enter an amount like 50 or 33.69.';

/**
 * Checks a typed split against the refund amount and what each method has
 * left, with the server's wording, and builds `payments[]` (cash first).
 */
export function validateRefundSplit(amountCents: number, refundable: MethodAmounts, draft: RefundSplitDraft): RefundSplitResult {
  const errors: RefundSplitErrors = {};
  const cash = amountOf(draft.cash);
  const gcash = amountOf(draft.gcash);
  if (cash === null) errors.cash = AMOUNT_FORMAT_MESSAGE;
  else if (cash > refundable.cash) errors.cash = methodLimitMessage('cash', refundable.cash);
  if (gcash === null) errors.gcash = AMOUNT_FORMAT_MESSAGE;
  else if (gcash > refundable.gcash) errors.gcash = methodLimitMessage('gcash', refundable.gcash);

  const reference = draft.reference.trim();
  if (gcash !== null && gcash > 0) {
    if (reference === '') errors.reference = 'Enter the reference of the GCash transfer back.';
    else if (reference.length > REFUND_REFERENCE_MAX) errors.reference = `Use ${REFUND_REFERENCE_MAX} characters or fewer.`;
    else if (!REFERENCE_PATTERN.test(reference)) errors.reference = 'Use only letters, numbers and dashes.';
  }

  const cashCents = cash ?? 0;
  const gcashCents = gcash ?? 0;
  if (cash !== null && gcash !== null && cashCents + gcashCents !== amountCents) errors.general = refundTotalMessage(amountCents);

  if (Object.keys(errors).length > 0) return { cashCents, gcashCents, payments: null, errors };
  const payments: RefundPaymentRequest[] = [];
  if (cashCents > 0) payments.push({ method: 'cash', amount_cents: cashCents, reference_no: null });
  if (gcashCents > 0) payments.push({ method: 'gcash', amount_cents: gcashCents, reference_no: reference });
  return { cashCents, gcashCents, payments, errors: null };
}

export type RefundRequestInput = {
  /** The refund's ULID (also the `Idempotency-Key`). */
  ulid: string;
  /** The refunding tablet's open shift. */
  shiftUlid: string;
  reason: string;
  pricing: RefundPricing;
  payments: RefundPaymentRequest[];
  authorization: ReversalAuthorization | null;
};

/** The `POST /orders/{ulid}/refunds` body. `items` keep the order's line order, so `items.{i}` errors map back. */
export function buildRefundRequest(input: RefundRequestInput): RefundCreateRequest {
  const items: RefundItemRequest[] = input.pricing.lines.map((line) => ({ order_item_id: line.item.id, qty: line.qty }));
  return {
    ulid: input.ulid,
    shift_ulid: input.shiftUlid,
    reason: input.reason.trim(),
    items,
    payments: input.payments,
    client_refund_cents: input.pricing.amount_cents,
    authorization: input.authorization,
  };
}

/** A sale that can still be refunded: `completed` or `partially_refunded`, with a unit left. */
export function hasRefundableLines(order: Pick<Order, 'status' | 'items'>): boolean {
  if (order.status !== 'completed' && order.status !== 'partially_refunded') return false;
  return order.items.some((item) => remainingQty(item) > 0);
}

/**
 * The Phase 7 fields with their "nothing reversed" values, for an order JSON
 * stored on the tablet before Phase 7 (local orders, print jobs). A field the
 * JSON already has is kept. Server responses always carry every field.
 * Senior Citizen / PWD Discount: an order stored before it gets `sc_pwd: null`
 * and lines with no SC/PWD share.
 */
export function withReversalDefaults<T extends PrintableOrder>(order: T): T {
  return {
    ...order,
    voided_at: order.voided_at ?? null,
    voided_by: order.voided_by ?? null,
    void_reason: order.void_reason ?? null,
    void_authorized_by: order.void_authorized_by ?? null,
    refunded_cents: order.refunded_cents ?? 0,
    refunds: order.refunds ?? [],
    sc_pwd: order.sc_pwd ?? null,
    items: order.items.map((item) => ({
      ...item,
      refunded_qty: item.refunded_qty ?? 0,
      refunded_cents: item.refunded_cents ?? 0,
      sc_pwd: item.sc_pwd ?? false,
      sc_pwd_eligible_cents: item.sc_pwd_eligible_cents ?? 0,
      sc_pwd_vat_relief_cents: item.sc_pwd_vat_relief_cents ?? 0,
      sc_pwd_discount_cents: item.sc_pwd_discount_cents ?? 0,
    })),
  };
}
