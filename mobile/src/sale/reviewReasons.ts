/**
 * Why a synced offline sale was flagged, in plain words (docs/api-contract.md
 * → Offline Sales → POST /sync/orders → Flags, and Orders module → Review).
 * The contract types `review_reasons` as `string[]`: a reason this build
 * doesn't know is shown as it is.
 */
import type { ReviewReason } from '@/services/types';

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  price_changed: 'Price changed during the outage',
  oversold: 'Sold more than the stock on hand',
  total_mismatch: "The tablet's total didn't match the server's",
  payment_short: 'The payment was short of the total',
  discount_over_limit: "The discount was over the cashier's limit",
  clock_skew: "The tablet's clock was ahead of the server's",
};

/** The plain-words label of one reason. */
export function reviewReasonLabel(reason: string): string {
  return Object.prototype.hasOwnProperty.call(REVIEW_REASON_LABELS, reason)
    ? REVIEW_REASON_LABELS[reason as ReviewReason]
    : reason;
}

/** Contract limit of the review `note`. */
export const REVIEW_NOTE_MAX = 255;
