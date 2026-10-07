/**
 * Checkout payments (docs/api-contract.md → POST /api/v1/orders → payments):
 * cash (the amount handed over), GCash (with a reference) and split tender.
 * The live "amount due" / "change" and the client-side checks mirror the
 * server's rules and wording; the server still checks everything.
 *
 * - at most one cash payment, at most 5 payments in all
 * - each amount 1–1000000000 centavos; GCash needs a reference (`[A-Za-z0-9-]`, max 64)
 * - GCash can't be more than the total; the sum must cover the total
 * - change = sum − total, and it comes out of the cash
 * - no payments at all only when the total is 0
 */
import type { OrderPaymentRequest, PaymentMethod } from '@/services/types';
import { formatPeso, parsePesoInput } from '@/utils/money';

/** "Cash", "GCash". */
export function paymentMethodLabel(method: PaymentMethod): string {
  return method === 'gcash' ? 'GCash' : 'Cash';
}

/** Quick cash buttons after "Exact": ₱100, ₱500, ₱1,000. */
export const QUICK_CASH_CENTS = [10_000, 50_000, 100_000] as const;

export const PAYMENT_LIMITS = {
  maxPayments: 5,
  amountMinCents: 1,
  amountMaxCents: 1_000_000_000,
  referenceMax: 64,
} as const;

const REFERENCE_PATTERN = /^[A-Za-z0-9-]+$/;

/** One GCash payment as typed. `key` is a local id for the row. */
export type GcashDraft = {
  key: string;
  amount: string;
  reference: string;
};

/** The payments as typed on the checkout screen. */
export type TenderDraft = {
  /** The cash handed over; empty = no cash payment. */
  cash: string;
  gcash: GcashDraft[];
};

export type GcashRowErrors = { amount?: string; reference?: string };

export type TenderErrors = {
  cash?: string;
  /** Per GCash row, by `key`. */
  gcash: Record<string, GcashRowErrors>;
  /** A rule over all payments (GCash over the total, short). */
  general?: string;
};

export type PaymentSummary = {
  cashCents: number;
  gcashCents: number;
  paidCents: number;
  /** What is still owed (0 once covered). */
  dueCents: number;
  /** The change to hand back (0 while short). */
  changeCents: number;
  /** GCash alone is more than the total (the server answers 422). */
  gcashOverTotal: boolean;
  /** The payments don't cover the total yet. */
  short: boolean;
};

/** The live totals of the payments against the sale total. */
export function summarizePayments(totalCents: number, cashCents: number, gcashCents: readonly number[]): PaymentSummary {
  const gcash = gcashCents.reduce((sum, amount) => sum + amount, 0);
  const paid = cashCents + gcash;
  const short = paid < totalCents;
  return {
    cashCents,
    gcashCents: gcash,
    paidCents: paid,
    dueCents: short ? totalCents - paid : 0,
    changeCents: short ? 0 : paid - totalCents,
    gcashOverTotal: gcash > totalCents,
    short,
  };
}

/** A typed amount in centavos: `0` when blank, `null` when it isn't a valid amount. */
function amountOf(text: string): number | null {
  if (text.trim() === '') return 0;
  return parsePesoInput(text);
}

/** The payments as they stand (invalid amounts count as 0), for the live display. */
export function summarizeDraft(totalCents: number, draft: TenderDraft): PaymentSummary {
  return summarizePayments(
    totalCents,
    amountOf(draft.cash) ?? 0,
    draft.gcash.map((row) => amountOf(row.amount) ?? 0),
  );
}

/** "Exact" cash: what the GCash payments leave to pay (nothing when they cover it). */
export function exactCashCents(totalCents: number, draft: TenderDraft): number {
  const gcash = draft.gcash.reduce((sum, row) => sum + (amountOf(row.amount) ?? 0), 0);
  return Math.max(0, totalCents - gcash);
}

/** The server's wording: "The payment is short by ₱<x>." */
export function shortMessage(dueCents: number): string {
  return `The payment is short by ${formatPeso(dueCents)}.`;
}

/** The server's wording. */
export const GCASH_OVER_TOTAL_MESSAGE = "GCash can't be more than the total.";

const AMOUNT_FORMAT_MESSAGE = 'Enter an amount like 500 or 250.50.';

function checkAmount(text: string, required: boolean): { cents: number | null; error?: string } {
  const cents = amountOf(text);
  if (cents === null) return { cents: null, error: AMOUNT_FORMAT_MESSAGE };
  if (cents === 0) return required ? { cents: null, error: 'Enter the amount paid.' } : { cents: 0 };
  if (cents > PAYMENT_LIMITS.amountMaxCents) {
    return { cents: null, error: `The amount can't be more than ${formatPeso(PAYMENT_LIMITS.amountMaxCents)}.` };
  }
  return { cents };
}

export type TenderValidation =
  | { payments: OrderPaymentRequest[]; errors: null; summary: PaymentSummary }
  | { payments: null; errors: TenderErrors; summary: PaymentSummary };

/**
 * Checks the typed payments against the sale total and builds `payments[]`
 * (cash first, then each GCash payment in the order added). A blank or zero
 * cash field means no cash payment.
 */
export function validateTender(totalCents: number, draft: TenderDraft): TenderValidation {
  const errors: TenderErrors = { gcash: {} };
  const payments: OrderPaymentRequest[] = [];
  let valid = true;

  const cash = checkAmount(draft.cash, false);
  if (cash.error) {
    errors.cash = cash.error;
    valid = false;
  } else if (cash.cents) {
    payments.push({ method: 'cash', amount_cents: cash.cents, reference_no: null });
  }

  for (const row of draft.gcash) {
    const rowErrors: GcashRowErrors = {};
    const amount = checkAmount(row.amount, true);
    if (amount.error) rowErrors.amount = amount.error;

    const reference = row.reference.trim();
    if (reference === '') rowErrors.reference = 'Enter the GCash reference number.';
    else if (reference.length > PAYMENT_LIMITS.referenceMax) {
      rowErrors.reference = `Use ${PAYMENT_LIMITS.referenceMax} characters or fewer.`;
    } else if (!REFERENCE_PATTERN.test(reference)) rowErrors.reference = 'Use only letters, numbers and dashes.';

    if (rowErrors.amount || rowErrors.reference) {
      errors.gcash[row.key] = rowErrors;
      valid = false;
    } else if (amount.cents) {
      payments.push({ method: 'gcash', amount_cents: amount.cents, reference_no: reference });
    }
  }

  const summary = summarizeDraft(totalCents, draft);
  if (valid) {
    if (payments.length > PAYMENT_LIMITS.maxPayments) {
      errors.general = `Use ${PAYMENT_LIMITS.maxPayments} payments or fewer.`;
    } else if (summary.gcashOverTotal) {
      errors.general = GCASH_OVER_TOTAL_MESSAGE;
    } else if (summary.short) {
      errors.general = shortMessage(summary.dueCents);
    }
  }

  if (!valid || errors.general) return { payments: null, errors, summary };
  return { payments, errors: null, summary };
}
