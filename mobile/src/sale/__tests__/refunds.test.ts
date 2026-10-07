/**
 * Refund amounts (docs/api-contract.md → Voids & Refunds (Phase 7) → Refund
 * amounts): the cumulative formula, worked example C, the VAT split, the
 * payment split, the request body, the action gating and the error mapping.
 */
import { ApiError, ApiValidationError } from '@/services/api';
import {
  buildRefundRequest,
  clampSelection,
  defaultRefundSplit,
  fullRefundSelection,
  hasRefundableLines,
  methodLimitMessage,
  priceRefund,
  refundableByMethod,
  refundLineAmount,
  validateRefundSplit,
  withReversalDefaults,
} from '@/sale/refunds';
import { classifyReversalError } from '@/sale/reversalErrors';
import {
  giveBackLines,
  orderStatusLabel,
  REFUND_NO_SHIFT_MESSAGE,
  REVERSAL_OFFLINE_MESSAGE,
  REVERSAL_UNSYNCED_MESSAGE,
  reversalGate,
  voidGiveBack,
  type ReversalGateInput,
} from '@/sale/reversals';
import type { PrintableOrder } from '@/services/types';
import { makeOrder, makePartlyRefundedOrder, makeRefund, TEST_SHIFT_ULID } from '@/test-utils/sale';

describe('refundLineAmount: rhu(T × (p + k), n) − rhu(T × p, n)', () => {
  it('worked example C: 1 of 3 Iced Teas (T = 10107) is 3369, the other 2 later are 6738, adding up to exactly T', () => {
    expect(refundLineAmount(10107, 3, 0, 1)).toBe(3369);
    expect(refundLineAmount(10107, 3, 1, 2)).toBe(6738);
    expect(3369 + 6738).toBe(10107);
  });

  it('refunding one unit at a time always adds up to the line total (cumulative rounding)', () => {
    for (const [total, qty] of [
      [10107, 3],
      [6930, 1],
      [8663, 2],
      [100, 7],
      [999_999_999, 13],
    ]) {
      let sum = 0;
      for (let refunded = 0; refunded < qty; refunded += 1) sum += refundLineAmount(total, qty, refunded, 1);
      expect(sum).toBe(total);
    }
  });

  it('stays exact past 2^53 intermediates (BigInt)', () => {
    // A ₱10,000,000 line of 999 units: every partial amount stays exact and the parts add up to T.
    expect(refundLineAmount(1_000_000_000, 999, 0, 998) + refundLineAmount(1_000_000_000, 999, 998, 1)).toBe(1_000_000_000);
  });

  it('refuses more than the remaining quantity', () => {
    expect(() => refundLineAmount(10107, 3, 2, 2)).toThrow('Only 1 left to refund.');
  });
});

describe('priceRefund', () => {
  const order = makeOrder();

  it('worked example C: V = 3369 → VATable 3008, VAT 361, VAT-exempt 0', () => {
    const pricing = priceRefund(order.items, { 103: 1 });
    expect(pricing).toMatchObject({ amount_cents: 3369, vatable_sales_cents: 3008, vat_amount_cents: 361, vat_exempt_sales_cents: 0, units: 1 });
    expect(pricing.lines.map((line) => [line.item.id, line.qty, line.amount_cents])).toEqual([[103, 1, 3369]]);
  });

  it('a full refund returns exactly total_cents, with the VAT split rounded once', () => {
    const pricing = priceRefund(order.items, fullRefundSelection(order.items));
    expect(pricing.amount_cents).toBe(order.total_cents);
    expect(pricing.vatable_sales_cents).toBe(order.vatable_sales_cents);
    expect(pricing.vat_amount_cents).toBe(order.vat_amount_cents);
    expect(pricing.vat_exempt_sales_cents).toBe(order.vat_exempt_sales_cents);
  });

  it('after the first refund, the rest of the sale adds up to total − refunded', () => {
    const partly = makePartlyRefundedOrder();
    const rest = fullRefundSelection(partly.items);
    expect(rest).toEqual({ 101: 1, 102: 2, 103: 2 });
    expect(priceRefund(partly.items, rest).amount_cents).toBe(25700 - 3369);
    expect(priceRefund(partly.items, { 103: 2 }).amount_cents).toBe(6738);
  });

  it('clamps a selection to the lines and to what is left', () => {
    const partly = makePartlyRefundedOrder();
    expect(clampSelection(partly.items, { 103: 5, 999: 1, 101: 0 })).toEqual({ 103: 2 });
    expect(priceRefund(partly.items, {}).lines).toEqual([]);
  });
});

describe('the payment split', () => {
  it('what each method has left: paid (cash net of change) − refunded so far', () => {
    expect(refundableByMethod(makeOrder())).toEqual({ cash: 15700, gcash: 10000 });
    expect(refundableByMethod(makePartlyRefundedOrder())).toEqual({ cash: 15700 - 3369, gcash: 10000 });
  });

  it('defaults to cash first, then GCash', () => {
    expect(defaultRefundSplit(3369, { cash: 15700, gcash: 10000 })).toEqual({ cash: 3369, gcash: 0 });
    expect(defaultRefundSplit(25700, { cash: 15700, gcash: 10000 })).toEqual({ cash: 15700, gcash: 10000 });
  });

  it('builds payments cash first; GCash needs its reference', () => {
    const left = { cash: 15700, gcash: 10000 };
    expect(validateRefundSplit(20000, left, { cash: '157', gcash: '43', reference: '' }).errors).toEqual({
      reference: 'Enter the reference of the GCash transfer back.',
    });
    expect(validateRefundSplit(20000, left, { cash: '157', gcash: '43', reference: 'G-1' }).payments).toEqual([
      { method: 'cash', amount_cents: 15700, reference_no: null },
      { method: 'gcash', amount_cents: 4300, reference_no: 'G-1' },
    ]);
  });

  it('never beyond what a method has left, and it must add up to the amount (the server\'s wording)', () => {
    const left = { cash: 1000, gcash: 10000 };
    expect(validateRefundSplit(3369, left, { cash: '33.69', gcash: '', reference: '' }).errors).toEqual({
      cash: methodLimitMessage('cash', 1000),
    });
    expect(methodLimitMessage('gcash', 10000)).toBe('Only ₱100.00 paid by GCash is left to refund.');
    expect(validateRefundSplit(3369, left, { cash: '10', gcash: '', reference: '' }).errors).toEqual({
      general: 'The refund must add up to ₱33.69.',
    });
  });
});

it('buildRefundRequest: the contract body of worked example C (Idempotency-Key = ulid)', () => {
  const pricing = priceRefund(makeOrder().items, { 103: 1 });
  expect(
    buildRefundRequest({
      ulid: '01K6R0A1B2C3D4E5F6G7H8J9KM',
      shiftUlid: TEST_SHIFT_ULID,
      reason: '  Wrong drink ',
      pricing,
      payments: [{ method: 'cash', amount_cents: 3369, reference_no: null }],
      authorization: { user_id: 2, pin: '1234' },
    }),
  ).toEqual({
    ulid: '01K6R0A1B2C3D4E5F6G7H8J9KM',
    shift_ulid: TEST_SHIFT_ULID,
    reason: 'Wrong drink',
    items: [{ order_item_id: 103, qty: 1 }],
    payments: [{ method: 'cash', amount_cents: 3369, reference_no: null }],
    client_refund_cents: 3369,
    authorization: { user_id: 2, pin: '1234' },
  });
});

it('hasRefundableLines and the status labels', () => {
  expect(hasRefundableLines(makeOrder())).toBe(true);
  expect(hasRefundableLines(makeOrder({ status: 'voided' }))).toBe(false);
  expect(hasRefundableLines(makeOrder({ status: 'refunded' }))).toBe(false);
  expect(orderStatusLabel('partially_refunded')).toBe('Partly refunded');
  expect(orderStatusLabel('voided')).toBe('Voided');
});

it('withReversalDefaults fills the Phase 7 fields of JSON stored before Phase 7', () => {
  const old = { ...makeOrder() } as Partial<PrintableOrder>;
  delete old.refunds;
  delete old.refunded_cents;
  const filled = withReversalDefaults(old as PrintableOrder);
  expect(filled.refunds).toEqual([]);
  expect(filled.refunded_cents).toBe(0);
});

describe('reversalGate (Device rules → Where the actions are)', () => {
  const base: ReversalGateInput = {
    order: makeOrder(),
    unsynced: false,
    online: true,
    currentShiftUlid: TEST_SHIFT_ULID,
    shiftLoading: false,
    canVoid: true,
    canRefund: true,
  };

  it('a completed sale of this tablet\'s open shift: Void sale and Refund', () => {
    expect(reversalGate(base)).toEqual({
      notice: null,
      void: { enabled: true, message: null },
      refund: { enabled: true, message: null },
    });
  });

  it('another shift: no Void sale; Refund stays', () => {
    const gate = reversalGate({ ...base, currentShiftUlid: '01K6S0A1B2C3D4E5F6G7H8J9KN' });
    expect(gate.void).toBeNull();
    expect(gate.refund).toEqual({ enabled: true, message: null });
  });

  it('offline: both disabled with the contract message', () => {
    const gate = reversalGate({ ...base, online: false });
    expect(gate.void).toEqual({ enabled: false, message: REVERSAL_OFFLINE_MESSAGE });
    expect(gate.refund).toEqual({ enabled: false, message: REVERSAL_OFFLINE_MESSAGE });
  });

  it('no open shift on this tablet: no Void sale, Refund disabled', () => {
    const gate = reversalGate({ ...base, currentShiftUlid: null });
    expect(gate.void).toBeNull();
    expect(gate.refund).toEqual({ enabled: false, message: REFUND_NO_SHIFT_MESSAGE });
  });

  it('a local sale that hasn\'t synced: the notice, no action', () => {
    expect(reversalGate({ ...base, unsynced: true })).toEqual({ notice: REVERSAL_UNSYNCED_MESSAGE, void: null, refund: null });
  });

  it('by status: partly refunded → Refund only; voided or refunded → nothing', () => {
    expect(reversalGate({ ...base, order: makeOrder({ status: 'partially_refunded' }) })).toMatchObject({ void: null, refund: { enabled: true } });
    expect(reversalGate({ ...base, order: makeOrder({ status: 'voided' }) })).toEqual({ notice: null, void: null, refund: null });
    expect(reversalGate({ ...base, order: makeOrder({ status: 'refunded' }) })).toEqual({ notice: null, void: null, refund: null });
  });

  it('without the permissions, nothing shows', () => {
    expect(reversalGate({ ...base, canVoid: false, canRefund: false })).toEqual({ notice: null, void: null, refund: null });
  });
});

it('give-back messages: the order\'s payments for a void, the refund\'s for a refund', () => {
  expect(giveBackLines('Sale voided.', voidGiveBack(makeOrder()))).toEqual(['Sale voided. Give back ₱157.00 cash', 'Send back ₱100.00 GCash']);
  const refund = makeRefund();
  expect(giveBackLines('Refund done.', { cash: refund.payments[0].amount_cents, gcash: 0 })).toEqual(['Refund done. Give back ₱33.69 cash']);
  expect(giveBackLines('Refund done.', { cash: 0, gcash: 500 })).toEqual(['Refund done. Send back ₱5.00 GCash']);
});

describe('classifyReversalError', () => {
  const sent = {
    items: [{ order_item_id: 103, qty: 3 }],
    payments: [
      { method: 'cash' as const, amount_cents: 100, reference_no: null },
      { method: 'gcash' as const, amount_cents: 200, reference_no: 'G' },
    ],
  };

  it('network errors and timeouts are unconfirmed (Retry with the same key)', () => {
    expect(classifyReversalError(new ApiError('x', { status: null, kind: 'timeout' }))).toEqual({ kind: 'unconfirmed' });
    expect(classifyReversalError(new ApiError('x', { status: null, kind: 'network' }))).toEqual({ kind: 'unconfirmed' });
  });

  it('the approval errors', () => {
    expect(classifyReversalError(new ApiValidationError('m', { authorization: ['A manager must approve this void.'] }))).toEqual({
      kind: 'approvalRequired',
      message: 'A manager must approve this void.',
    });
    expect(classifyReversalError(new ApiValidationError('m', { 'authorization.user_id': ["This person can't approve refunds."] })).kind).toBe(
      'approverRejected',
    );
    expect(classifyReversalError(new ApiValidationError('m', { 'authorization.pin': ['Incorrect PIN.'] })).kind).toBe('wrongPin');
    expect(classifyReversalError(new ApiError('Too many incorrect PIN attempts. Try again in 3 minutes.', { status: 429, kind: 'http' })).kind).toBe(
      'pinLocked',
    );
  });

  it('a quantity or checksum 422 refetches; lines map back by order_item_id; payments by method', () => {
    const quantity = classifyReversalError(new ApiValidationError('m', { 'items.0.qty': ['Only 2 left to refund.'] }), sent);
    expect(quantity).toMatchObject({ kind: 'invalid', refetch: true, message: 'Only 2 left to refund.', fields: { lines: { 103: 'Only 2 left to refund.' } } });
    const checksum = classifyReversalError(new ApiValidationError('m', { client_refund_cents: ['The refund amount has changed. Review it.'] }), sent);
    expect(checksum).toMatchObject({ kind: 'invalid', refetch: true, fields: { checksum: 'The refund amount has changed. Review it.' } });
    const payments = classifyReversalError(
      new ApiValidationError('m', { 'payments.1.amount_cents': ['Only ₱1.00 paid by GCash is left to refund.'], 'payments.1.reference_no': ['Bad.'] }),
      sent,
    );
    expect(payments).toMatchObject({ kind: 'invalid', refetch: false, fields: { gcash: 'Only ₱1.00 paid by GCash is left to refund.', reference: 'Bad.' } });
  });

  it('a closed shift goes back to Open a shift; other 409s are conflicts; the key reuse is looked up', () => {
    expect(classifyReversalError(new ApiValidationError('m', { shift_ulid: ['This shift is closed. Open a new shift.'] })).kind).toBe('shiftClosed');
    expect(classifyReversalError(new ApiError("This sale's shift is closed. Refund it instead.", { status: 409, kind: 'http' }))).toEqual({
      kind: 'conflict',
      message: "This sale's shift is closed. Refund it instead.",
    });
    expect(
      classifyReversalError(new ApiError('This Idempotency-Key was already used for a different request.', { status: 409, kind: 'http' })).kind,
    ).toBe('alreadyUsed');
    expect(classifyReversalError(new ApiError('This request is still being processed. Try again in a moment.', { status: 409, kind: 'http' })).kind).toBe(
      'inFlight',
    );
  });
});
