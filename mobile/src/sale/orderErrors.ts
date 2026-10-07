/**
 * What a failed `POST /api/v1/orders` means for the cashier
 * (docs/api-contract.md → POST /orders → Checks, and Global Conventions →
 * Idempotent requests). Each kind has one handling on the checkout screen:
 *
 * - `unconfirmed`: network error or timeout. The sale may have gone through.
 *   Offline Sales (Phase 5): the checkout saves it on the tablet with the
 *   **same** ULID (a sale the server did commit syncs back as `duplicate`);
 *   when it can't, it retries with the same ULID (and the same body).
 *   A 4xx is never `unconfirmed`, so it never falls back to offline.
 * - `inFlight`: `409` while the first attempt is still running: retry shortly.
 * - `alreadyUsed`: `409`, the ULID was already used by a successful request: the sale
 *   exists, so the checkout looks it up with `GET /orders/{ulid}` (Q-004).
 * - `checksum`: `422` on `client_total_cents`: sync the menu, re-price, show the message.
 * - `approvalRequired` / `approverRejected` / `wrongPin`: the manager-approval flow.
 * - `pinLocked`: `429` (an approver's PIN is locked).
 * - `cart`: line, order-discount, customer, table or SC/PWD messages (`sc_pwd`
 *   and its fields, shown on the SC/PWD sheet's fields): back to the cart.
 * - `payments`: shown with the payments.
 * - `shiftClosed` (Shifts & Reporting, Phase 6): `422` on `shift_ulid`, "This
 *   shift is closed. Open a new shift.": the tablet's shift is closed and the
 *   cashier goes back to "Open a shift" (the cart is kept).
 * - `other`: a banner with the server's message (403, other 409s, 5xx, …).
 */
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import type { ServerCartErrors } from '@/stores/cart';

/** Contract wording of the in-flight `409`. */
export const IN_FLIGHT_MESSAGE = 'This request is still being processed. Try again in a moment.';

/** Contract wording of the `409` for a key an earlier, successful request already used: the sale exists. */
export const KEY_REUSED_MESSAGE = 'This Idempotency-Key was already used for a different request.';

/** Q-004: the earlier sale was found (GET /orders/{ulid} → 200). */
export const EARLIER_ATTEMPT_NOTE = 'An earlier attempt already completed this sale.';

/** Q-004: the earlier sale can't be shown (GET /orders/{ulid} → 404 or 403). */
export const ALREADY_RECORDED_MESSAGE = 'This sale was already recorded. Check Orders before charging again.';

/**
 * Contract (App → Submitting): shown after a timeout or a network error when
 * the sale can't fall back to the tablet (Offline Sales, Phase 5: the checkout
 * saves an `unconfirmed` sale offline with the same ULID whenever it can).
 */
export const UNCONFIRMED_MESSAGE = "We couldn't confirm the sale. Retry.";

/** Contract (Phase 6): the online sale's shift is known to the server and closed. */
export const SHIFT_CLOSED_MESSAGE = 'This shift is closed. Open a new shift.';

export type OrderFailure =
  | { kind: 'unconfirmed'; message: string }
  | { kind: 'inFlight'; message: string }
  | { kind: 'alreadyUsed'; message: string }
  | { kind: 'checksum'; message: string }
  | { kind: 'approvalRequired'; message: string }
  | { kind: 'approverRejected'; message: string }
  | { kind: 'wrongPin'; message: string }
  | { kind: 'pinLocked'; message: string }
  | { kind: 'cart'; errors: ServerCartErrors; message: string }
  | { kind: 'payments'; message: string }
  | { kind: 'shiftClosed'; message: string }
  | { kind: 'other'; message: string };

const LINE_FIELD = /^items\.(\d+)\./;

function first(messages: string[] | undefined): string | null {
  return messages?.[0] ?? null;
}

/** Classifies a 422 from POST /orders by the fields it names. */
function classifyValidation(message: string, errors: Record<string, string[]>): OrderFailure {
  const checksum = first(errors.client_total_cents);
  if (checksum) return { kind: 'checksum', message: checksum };

  const approval = first(errors.discount_authorization);
  if (approval) return { kind: 'approvalRequired', message: approval };
  const approver = first(errors['discount_authorization.user_id']);
  if (approver) return { kind: 'approverRejected', message: approver };
  const pin = first(errors['discount_authorization.pin']);
  if (pin) return { kind: 'wrongPin', message: pin };

  const shift = first(errors.shift_ulid);
  if (shift && shift.trim() === SHIFT_CLOSED_MESSAGE) return { kind: 'shiftClosed', message: shift };

  const cart: ServerCartErrors = { lines: {}, orderDiscount: null, customer: null, table: null, scPwd: {}, cart: null };
  let cartProblem = false;
  let payments: string | null = null;
  let other: string | null = null;

  for (const [field, messages] of Object.entries(errors)) {
    const text = first(messages);
    if (!text) continue;
    const line = LINE_FIELD.exec(field);
    if (line) {
      const index = Number(line[1]);
      // One message per line: several fields of one line are joined (e.g. qty and discount).
      cart.lines[index] = cart.lines[index] ? `${cart.lines[index]} ${text}` : text;
      cartProblem = true;
    } else if (field === 'items') {
      cart.cart = text;
      cartProblem = true;
    } else if (field === 'discount' || field.startsWith('discount.')) {
      cart.orderDiscount = cart.orderDiscount ?? text;
      cartProblem = true;
    } else if (field === 'customer_id') {
      cart.customer = text;
      cartProblem = true;
    } else if (field === 'table_no') {
      cart.table = text;
      cartProblem = true;
    } else if (field === 'sc_pwd' || field.startsWith('sc_pwd.')) {
      // Senior Citizen / PWD Discount: by the path after `sc_pwd.` (e.g. `persons.0.id_no`, `diners`).
      const scPwd = cart.scPwd ?? {};
      const path = field === 'sc_pwd' ? '' : field.slice('sc_pwd.'.length);
      scPwd[path] = scPwd[path] ?? text;
      cart.scPwd = scPwd;
      cartProblem = true;
    } else if (field === 'payments' || field.startsWith('payments.')) {
      payments = payments ?? text;
    } else {
      other = other ?? text;
    }
  }

  if (cartProblem) return { kind: 'cart', errors: cart, message };
  if (payments) return { kind: 'payments', message: payments };
  return { kind: 'other', message: other ?? message };
}

/** What a thrown error from `createOrder` means (see the module notes). */
export function classifyOrderError(error: unknown): OrderFailure {
  if (isApiValidationError(error)) return classifyValidation(error.message, error.errors);
  if (isApiError(error)) {
    if (error.kind === 'network' || error.kind === 'timeout') return { kind: 'unconfirmed', message: UNCONFIRMED_MESSAGE };
    if (error.status === 409 && error.message.trim() === IN_FLIGHT_MESSAGE) return { kind: 'inFlight', message: error.message };
    // Q-004: an earlier attempt with this ULID created the sale; the checkout looks it up.
    if (error.status === 409 && error.message.trim() === KEY_REUSED_MESSAGE) return { kind: 'alreadyUsed', message: error.message };
    if (error.status === 429) return { kind: 'pinLocked', message: error.message };
  }
  return { kind: 'other', message: getErrorMessage(error) };
}
