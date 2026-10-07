/**
 * What a failed void (`POST /orders/{ulid}/void`) or refund
 * (`POST /orders/{ulid}/refunds`) means for staff (docs/api-contract.md →
 * Voids & Refunds → Checks, and Global Conventions → Idempotent requests).
 *
 * - `unconfirmed`: network error or timeout. It may have gone through: the
 *   form locks and **Retry** resends the same body with the same key.
 * - `inFlight`: `409` while the first attempt is still running: retry shortly.
 * - `alreadyUsed`: `409`, the key was already used by a successful request:
 *   the app looks the order up (`GET /orders/{ulid}`), as for sales (Q-004).
 * - `approvalRequired` / `approverRejected` / `wrongPin` / `pinLocked`: the
 *   manager-approval flow (`422` on `authorization`, `authorization.user_id`,
 *   `authorization.pin`; `429`).
 * - `shiftClosed`: `422` on `shift_ulid` ("This shift is closed. Open a new
 *   shift."): back to Sell's **Open a shift**, like a sale.
 * - `invalid`: other `422`s, by field. `refetch` is set for a quantity
 *   (`items.{i}.qty`, `items.{i}.order_item_id`, `items`) or checksum
 *   (`client_refund_cents`) problem: the order is fetched again and re-priced.
 * - `conflict`: another `409` (the sale's state or window, another tablet's
 *   shift, an unregistered tablet): shown as it is, and the order is re-read.
 * - `other`: `403`, `404`, `5xx`, …: the server's message.
 */
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import type { PaymentMethod, RefundItemRequest, RefundPaymentRequest } from '@/services/types';

import { IN_FLIGHT_MESSAGE, KEY_REUSED_MESSAGE, SHIFT_CLOSED_MESSAGE } from './orderErrors';

export type ReversalFieldErrors = {
  reason?: string;
  /** By `order_item_id`. */
  lines: Record<number, string>;
  /** A quantity or line problem that isn't tied to one line (e.g. on `items`). */
  items?: string;
  checksum?: string;
  cash?: string;
  gcash?: string;
  reference?: string;
  /** On `payments` (e.g. "The refund must add up to ₱33.69."). */
  payments?: string;
};

export type ReversalFailure =
  | { kind: 'unconfirmed' }
  | { kind: 'inFlight'; message: string }
  | { kind: 'alreadyUsed'; message: string }
  | { kind: 'approvalRequired'; message: string }
  | { kind: 'approverRejected'; message: string }
  | { kind: 'wrongPin'; message: string }
  | { kind: 'pinLocked'; message: string }
  | { kind: 'shiftClosed'; message: string }
  | { kind: 'invalid'; message: string; fields: ReversalFieldErrors; refetch: boolean }
  | { kind: 'conflict'; message: string }
  | { kind: 'other'; message: string };

/** What was sent, so indexed field names (`items.0.qty`, `payments.1.amount_cents`) map back. */
export type SentReversal = {
  items?: readonly RefundItemRequest[];
  payments?: readonly RefundPaymentRequest[];
};

const ITEM_FIELD = /^items\.(\d+)\.(qty|order_item_id)$/;
const PAYMENT_FIELD = /^payments\.(\d+)\.(amount_cents|reference_no|method)$/;

function first(messages: string[] | undefined): string | null {
  return messages?.[0] ?? null;
}

function methodField(method: PaymentMethod | undefined): 'cash' | 'gcash' | null {
  if (method === 'cash') return 'cash';
  if (method === 'gcash') return 'gcash';
  return null;
}

function classifyValidation(message: string, errors: Record<string, string[]>, sent: SentReversal): ReversalFailure {
  const approval = first(errors.authorization);
  if (approval) return { kind: 'approvalRequired', message: approval };
  const approver = first(errors['authorization.user_id']);
  if (approver) return { kind: 'approverRejected', message: approver };
  const pin = first(errors['authorization.pin']);
  if (pin) return { kind: 'wrongPin', message: pin };

  const shift = first(errors.shift_ulid);
  if (shift && shift.trim() === SHIFT_CLOSED_MESSAGE) return { kind: 'shiftClosed', message: shift };

  const fields: ReversalFieldErrors = { lines: {} };
  let refetch = false;
  let banner: string | null = null;

  for (const [field, messages] of Object.entries(errors)) {
    const text = first(messages);
    if (!text) continue;
    const item = ITEM_FIELD.exec(field);
    const payment = PAYMENT_FIELD.exec(field);
    if (item) {
      refetch = true;
      const id = sent.items?.[Number(item[1])]?.order_item_id;
      if (id !== undefined) fields.lines[id] = fields.lines[id] ? `${fields.lines[id]} ${text}` : text;
      else fields.items = fields.items ?? text;
    } else if (field === 'items' || field.startsWith('items.')) {
      refetch = true;
      fields.items = fields.items ?? text;
    } else if (field === 'client_refund_cents') {
      refetch = true;
      fields.checksum = text;
    } else if (payment) {
      if (payment[2] === 'reference_no') {
        fields.reference = fields.reference ?? text;
      } else {
        const slot = methodField(sent.payments?.[Number(payment[1])]?.method);
        if (slot) fields[slot] = fields[slot] ?? text;
        else fields.payments = fields.payments ?? text;
      }
    } else if (field === 'payments') {
      fields.payments = fields.payments ?? text;
    } else if (field === 'reason') {
      fields.reason = text;
    } else {
      banner = banner ?? text;
    }
  }

  // The banner names what must be fixed first: the lines or the amount (re-priced), else the server's own summary.
  const headline = fields.checksum ?? fields.items ?? Object.values(fields.lines)[0] ?? banner ?? message;
  return { kind: 'invalid', message: headline, fields, refetch };
}

/** What a thrown error from `voidOrder` / `refundOrder` means (see the module notes). */
export function classifyReversalError(error: unknown, sent: SentReversal = {}): ReversalFailure {
  if (isApiValidationError(error)) return classifyValidation(error.message, error.errors, sent);
  if (isApiError(error)) {
    if (error.kind === 'network' || error.kind === 'timeout') return { kind: 'unconfirmed' };
    if (error.status === 409 && error.message.trim() === IN_FLIGHT_MESSAGE) return { kind: 'inFlight', message: error.message };
    if (error.status === 409 && error.message.trim() === KEY_REUSED_MESSAGE) return { kind: 'alreadyUsed', message: error.message };
    if (error.status === 409) return { kind: 'conflict', message: error.message };
    if (error.status === 429) return { kind: 'pinLocked', message: error.message };
  }
  return { kind: 'other', message: getErrorMessage(error) };
}
