/** The in-memory cart (contract → Core Sale → App → Cart). */
import { CART_LIMITS, resetCart, useCartStore, type CartProduct } from '@/stores/cart';
import { isUlid } from '@/utils/ulid';

const egg: CartProduct = {
  id: 1,
  category_id: 1,
  name: 'Egg with Rice',
  sku: 'BRK-001',
  price_cents: 5000,
  is_vatable: true,
  is_available: true,
  track_stock: false,
};
const tea: CartProduct = { ...egg, id: 4, category_id: 3, name: 'Iced Tea', sku: 'DRK-001', price_cents: 3500, track_stock: true };

function cart() {
  return useCartStore.getState();
}

beforeEach(() => {
  resetCart();
});

describe('adding products', () => {
  it('adds a line with qty 1, then increments that line', () => {
    expect(cart().addProduct(egg)).toBe('added');
    expect(cart().addProduct(egg)).toBe('incremented');
    expect(cart().addProduct(tea)).toBe('added');

    expect(cart().lines.map((line) => [line.product.id, line.qty])).toEqual([
      [1, 2],
      [4, 1],
    ]);
    expect(cart().lines[0].product).toEqual(egg);
  });

  it('starts a new line when the existing one has a discount or a note', () => {
    cart().addProduct(egg);
    const key = cart().lines[0].key;
    cart().updateLine(key, { qty: 1, discount: { type: 'promo', kind: 'percent', value: 1000 }, notes: null });
    expect(cart().addProduct(egg)).toBe('added');

    const second = cart().lines[1].key;
    cart().updateLine(second, { qty: 1, discount: null, notes: 'No ketchup' });
    expect(cart().addProduct(egg)).toBe('added');
    expect(cart().lines).toHaveLength(3);
  });

  it('never adds an unavailable product', () => {
    expect(cart().addProduct({ ...egg, is_available: false })).toBe('unavailable');
    expect(cart().lines).toHaveLength(0);
  });

  it('keeps to 999 per line and 100 lines', () => {
    cart().addProduct(egg);
    cart().setQty(cart().lines[0].key, 5000);
    expect(cart().lines[0].qty).toBe(CART_LIMITS.maxQty);
    expect(cart().addProduct(egg)).toBe('maxQty');

    resetCart();
    for (let id = 1; id <= CART_LIMITS.maxLines; id += 1) cart().addProduct({ ...egg, id });
    expect(cart().addProduct({ ...egg, id: 1000 })).toBe('maxLines');
    expect(cart().lines).toHaveLength(100);
  });
});

describe('editing', () => {
  it('sets qty (1–999), edits discount and notes (trimmed, max 120), and removes lines', () => {
    cart().addProduct(egg);
    cart().addProduct(tea);
    const [first, second] = cart().lines.map((line) => line.key);

    cart().setQty(first, 0);
    expect(cart().lines[0].qty).toBe(1);
    cart().updateLine(first, { qty: 3, discount: { type: 'manual', kind: 'amount', value: 500 }, notes: `  ${'x'.repeat(130)}  ` });
    expect(cart().lines[0]).toMatchObject({ qty: 3, discount: { type: 'manual', kind: 'amount', value: 500 } });
    expect(cart().lines[0].notes).toHaveLength(120);
    cart().updateLine(first, { qty: 3, discount: null, notes: '   ' });
    expect(cart().lines[0].notes).toBeNull();

    cart().removeLine(second);
    expect(cart().lines.map((line) => line.key)).toEqual([first]);
  });

  it('sets the order discount and the customer, and clear() empties everything', () => {
    cart().addProduct(egg);
    cart().setOrderDiscount({ type: 'promo', kind: 'amount', value: 1000 });
    cart().setCustomer({ id: 12, full_name: 'Maria Santos' });
    cart().setTender({ cash: '500', gcash: [] });
    cart().beginCheckout();

    cart().clear();

    expect(cart()).toMatchObject({
      lines: [],
      orderDiscount: null,
      customer: null,
      pendingUlid: null,
      tender: { cash: '', gcash: [] },
      awaitingConfirmation: false,
    });
  });
});

describe('the pending sale ULID', () => {
  it('is generated when checkout starts and reused until the sale is created', () => {
    cart().addProduct(egg);
    expect(cart().pendingUlid).toBeNull();

    const first = cart().beginCheckout();
    expect(isUlid(first)).toBe(true);
    // Retries, a 422 correction, an approval resubmit: the same ULID.
    expect(cart().beginCheckout()).toBe(first);
    cart().setQty(cart().lines[0].key, 2);
    expect(cart().beginCheckout()).toBe(first);

    // 201: a new sale starts with a new ULID.
    cart().completeSale();
    expect(cart().pendingUlid).toBeNull();
    expect(cart().lines).toEqual([]);
    cart().addProduct(egg);
    const next = cart().beginCheckout();
    expect(next).not.toBe(first);
    expect(isUlid(next)).toBe(true);
  });

  it('is dropped by clearing the cart', () => {
    cart().addProduct(egg);
    const first = cart().beginCheckout();
    cart().clear();
    cart().addProduct(egg);
    expect(cart().beginCheckout()).not.toBe(first);
  });
});

describe('an unconfirmed attempt', () => {
  it('locks the cart and the payments until an answer comes, but still allows clearing', () => {
    cart().addProduct(egg);
    cart().setTender({ cash: '100', gcash: [] });
    const key = cart().lines[0].key;
    const ulid = cart().beginCheckout();
    cart().setAwaitingConfirmation(true);

    expect(cart().addProduct(egg)).toBe('locked');
    cart().setQty(key, 5);
    cart().removeLine(key);
    cart().setOrderDiscount({ type: 'promo', kind: 'percent', value: 5000 });
    cart().setCustomer({ id: 1, full_name: 'X' });
    cart().setTender({ cash: '999', gcash: [] });
    expect(cart()).toMatchObject({ orderDiscount: null, customer: null, tender: { cash: '100', gcash: [] } });
    expect(cart().lines).toEqual([expect.objectContaining({ key, qty: 1 })]);
    expect(cart().beginCheckout()).toBe(ulid);

    cart().clear();
    expect(cart()).toMatchObject({ lines: [], awaitingConfirmation: false, pendingUlid: null });
  });
});

describe('server messages and re-pricing', () => {
  it('maps a rejected sale’s messages onto its lines by index, and clears one when its line changes', () => {
    cart().addProduct(egg);
    cart().addProduct(tea);
    const [first, second] = cart().lines.map((line) => line.key);
    const request = cart().showCartRequest;

    cart().showServerErrors({ lines: { 1: 'Only 2 "Iced Tea" left in stock.' }, orderDiscount: null, customer: null, cart: null });

    expect(cart().lineErrors).toEqual({ [second]: 'Only 2 "Iced Tea" left in stock.' });
    expect(cart().showCartRequest).toBe(request + 1);
    cart().setQty(first, 2);
    expect(cart().lineErrors[second]).toBeDefined();
    cart().setQty(second, 2);
    expect(cart().lineErrors).toEqual({});
  });

  it('replaces the product snapshots of matching lines', () => {
    cart().addProduct(egg);
    cart().addProduct(tea);
    cart().repriceProducts([{ ...egg, price_cents: 5500 }]);
    expect(cart().lines.map((line) => line.product.price_cents)).toEqual([5500, 3500]);
  });
});
