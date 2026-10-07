/** What each failure of POST /api/v1/orders means for the checkout (contract → POST /orders → Checks; Idempotent requests). */
import { ApiError, ApiValidationError } from '@/services/api';
import { classifyOrderError, IN_FLIGHT_MESSAGE, KEY_REUSED_MESSAGE, UNCONFIRMED_MESSAGE } from '@/sale/orderErrors';

function invalid(errors: Record<string, string[]>) {
  return new ApiValidationError('The given data was invalid.', errors);
}

describe('classifyOrderError', () => {
  it('network errors and timeouts leave the sale unconfirmed (retry with the same ULID)', () => {
    expect(classifyOrderError(new ApiError('x', { status: null, kind: 'network' }))).toEqual({
      kind: 'unconfirmed',
      message: UNCONFIRMED_MESSAGE,
    });
    expect(classifyOrderError(new ApiError('x', { status: null, kind: 'timeout' })).kind).toBe('unconfirmed');
  });

  it('a 409 while the first attempt still runs is retried; a used key means the sale exists (Q-004)', () => {
    expect(classifyOrderError(new ApiError(IN_FLIGHT_MESSAGE, { status: 409, kind: 'http' })).kind).toBe('inFlight');
    const reused = new ApiError(KEY_REUSED_MESSAGE, { status: 409, kind: 'http' });
    expect(classifyOrderError(reused)).toEqual({ kind: 'alreadyUsed', message: KEY_REUSED_MESSAGE });
    const unknown = new ApiError('Some other conflict.', { status: 409, kind: 'http' });
    expect(classifyOrderError(unknown)).toEqual({ kind: 'other', message: 'Some other conflict.' });
  });

  it('a 429 is a locked PIN', () => {
    const locked = new ApiError('Too many incorrect PIN attempts. Try again in 12 minutes.', { status: 429, kind: 'http' });
    expect(classifyOrderError(locked)).toEqual({ kind: 'pinLocked', message: locked.message });
  });

  it('the checksum 422', () => {
    const message = 'The menu has changed since your last sync. Review the new total.';
    expect(classifyOrderError(invalid({ client_total_cents: [message] }))).toEqual({ kind: 'checksum', message });
  });

  it('the approval 422s', () => {
    expect(classifyOrderError(invalid({ discount_authorization: ['A manager must approve this discount.'] })).kind).toBe(
      'approvalRequired',
    );
    expect(classifyOrderError(invalid({ 'discount_authorization.user_id': ["This person can't approve this discount."] })).kind).toBe(
      'approverRejected',
    );
    expect(classifyOrderError(invalid({ 'discount_authorization.pin': ['Incorrect PIN.'] }))).toEqual({
      kind: 'wrongPin',
      message: 'Incorrect PIN.',
    });
  });

  it('stock and menu 422s go back to the cart, one message per line index', () => {
    const failure = classifyOrderError(
      invalid({
        'items.0.qty': ['Only 2 "Iced Tea" left in stock.'],
        'items.2.qty': ['Only 2 "Iced Tea" left in stock.'],
        'items.1.product_id': ['"Hot Dog" is unavailable.'],
        'discount.value': ["The discount can't be more than ₱267.00."],
        customer_id: ['The selected customer id is invalid.'],
      }),
    );
    expect(failure).toMatchObject({
      kind: 'cart',
      errors: {
        lines: { 0: 'Only 2 "Iced Tea" left in stock.', 1: '"Hot Dog" is unavailable.', 2: 'Only 2 "Iced Tea" left in stock.' },
        orderDiscount: "The discount can't be more than ₱267.00.",
        customer: 'The selected customer id is invalid.',
        cart: null,
      },
    });
    expect(classifyOrderError(invalid({ items: ['This sale is too large.'] }))).toMatchObject({
      kind: 'cart',
      errors: { cart: 'This sale is too large.' },
    });
  });

  it('payment 422s stay on the checkout', () => {
    expect(classifyOrderError(invalid({ payments: ["GCash can't be more than the total."] }))).toEqual({
      kind: 'payments',
      message: "GCash can't be more than the total.",
    });
  });

  it('anything else is a banner with the server message', () => {
    expect(classifyOrderError(new ApiError('This action is unauthorized.', { status: 403, kind: 'http' }))).toEqual({
      kind: 'other',
      message: 'This action is unauthorized.',
    });
    expect(classifyOrderError(invalid({ idempotency_key: ['Bad key.'] }))).toEqual({ kind: 'other', message: 'Bad key.' });
  });
});
