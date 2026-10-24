/**
 * Table Number (Core Sale revision 2): the client check (the server's rule),
 * the cart store field, and a `422` on `table_no` sent back to the cart.
 */
import { buildOrderRequest } from '@pos/core/sale/order';
import { classifyOrderError } from '@/sale/orderErrors';
import { parseTableNo, TABLE_NO_INVALID, TABLE_NO_TOO_LONG } from '@pos/core/sale/table';
import { ApiValidationError } from '@/services/api';
import { resetCart, useCartStore } from '@/stores/cart';
import { HOT_DOG } from '@/test-utils/sale';

describe('parseTableNo', () => {
  it.each([
    ['12', '12'],
    ['A3', 'A3'],
    ['Patio 2', 'Patio 2'],
    ['  B-4  ', 'B-4'],
    ['1234567890', '1234567890'],
  ])('%p → %p', (text, value) => {
    expect(parseTableNo(text)).toEqual({ value, error: null });
  });

  it('treats empty or blank as no table', () => {
    expect(parseTableNo('')).toEqual({ value: null, error: null });
    expect(parseTableNo('   ')).toEqual({ value: null, error: null });
  });

  it('refuses more than 10 characters (after trimming) and anything but letters, digits, spaces and hyphens', () => {
    expect(parseTableNo('12345678901')).toEqual({ value: null, error: TABLE_NO_TOO_LONG });
    expect(parseTableNo('  1234567890  ').error).toBeNull();
    expect(parseTableNo('#12').error).toBe(TABLE_NO_INVALID);
    expect(parseTableNo('Niño 1').error).toBe(TABLE_NO_INVALID);
    expect(parseTableNo('12/3').error).toBe(TABLE_NO_INVALID);
  });
});

describe('the cart store', () => {
  beforeEach(() => resetCart());

  it('keeps the table as typed, and clears it with the cart and when the sale completes', () => {
    const cart = () => useCartStore.getState();
    cart().setTableNo(' 12 ');
    expect(cart().tableNo).toBe(' 12 ');
    cart().clear();
    expect(cart().tableNo).toBe('');

    cart().setTableNo('A3');
    cart().completeSale();
    expect(cart().tableNo).toBe('');
  });

  it('is locked while a sale attempt is unconfirmed, like the rest of the cart', () => {
    const cart = () => useCartStore.getState();
    cart().setTableNo('12');
    cart().setAwaitingConfirmation(true);
    cart().setTableNo('99');
    expect(cart().tableNo).toBe('12');
  });

  it('shows a server message on table_no until the table changes or the next attempt', () => {
    const cart = () => useCartStore.getState();
    cart().addProduct(HOT_DOG);
    cart().showServerErrors({ lines: {}, orderDiscount: null, customer: null, table: 'The table no field format is invalid.', cart: null });
    expect(cart().tableError).toBe('The table no field format is invalid.');
    cart().setTableNo('12');
    expect(cart().tableError).toBeNull();
    cart().showServerErrors({ lines: {}, orderDiscount: null, customer: null, table: 'Again.', cart: null });
    cart().clearServerErrors();
    expect(cart().tableError).toBeNull();
  });
});

describe('the order request and its errors', () => {
  it('buildOrderRequest sends table_no', () => {
    const body = buildOrderRequest({
      ulid: '01K62Z3K5Q9V7X2M4N6P8R0T1W',
      lines: [],
      orderDiscount: null,
      customer: null,
      tableNo: 'A3',
      shiftUlid: '01K6S0A1B2C3D4E5F6G7H8J9KM',
      payments: [],
      clientTotalCents: 0,
      authorization: null,
      scPwd: null,
    });
    expect(body.table_no).toBe('A3');
  });

  it('a 422 on table_no goes back to the cart, under the Table field', () => {
    const failure = classifyOrderError(
      new ApiValidationError('The table no field format is invalid.', { table_no: ['The table no field format is invalid.'] }),
    );
    expect(failure).toMatchObject({ kind: 'cart', errors: { table: 'The table no field format is invalid.' } });
  });
});
