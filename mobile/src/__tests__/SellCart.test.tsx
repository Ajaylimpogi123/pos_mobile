/**
 * The Sell screen's cart (contract → Core Sale → App → Cart, Sell screen):
 * tile taps, the side panel on tablet landscape vs the bottom bar + sheet on
 * phones and portrait, line and order discounts, the customer picker, clear,
 * and the read-only screen for users without `sale.create`.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import SellRoute from '@/app/(app)/(pos)/sell/index';
import { catalogueRepository } from '@/db/catalogueRepository';
import { resetCart, useCartStore } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { cashierUser, mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { page, renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { seedOpenShift } from '@/test-utils/shifts';
import { makeCustomer, viewerUser } from '@/test-utils/staff';
import { SERVER_TIME, seedMenu, syncProduct } from '@/test-utils/sync';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const FUTURE = '2099-09-25T01:30:00Z';

async function storeMenu(products = seedMenu().products) {
  await catalogueRepository.replaceCatalogue(
    { categories: seedMenu().categories, products },
    { cursor: 'c1', apiOrigin: 'http://192.168.1.50:8000', serverTime: SERVER_TIME },
  );
}

async function renderSell() {
  const result = await renderWithQuery(<SellRoute />);
  await waitFor(() => expect(screen.queryByTestId('sell-loading')).toBeNull());
  return result;
}

async function tap(productId: number) {
  await fireEvent.press(screen.getByTestId(`product-tile-${productId}-body`));
}

/** A message element shows exactly `message` (an icon glyph is part of the element's text content). */
function expectText(testID: string, message: string) {
  expect(within(screen.getByTestId(testID)).getByText(message)).toBeOnTheScreen();
}

beforeEach(async () => {
  await freshTestDatabase();
  // Phase 6: sales need an open shift on the tablet.
  seedOpenShift();
  useSyncStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  resetCart();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  (router.push as jest.Mock).mockClear();
});

afterEach(() => {
  resetWindowSize();
});

describe('tablet landscape: the cart is always visible beside the menu', () => {
  it('shows the side panel (no bar); a tap adds 1, another tap increments that line', async () => {
    await storeMenu();
    await renderSell();

    expect(screen.getByTestId('cart-panel-side')).toBeOnTheScreen();
    expect(screen.queryByTestId('cart-bar')).toBeNull();
    expect(screen.getByTestId('cart-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('cart-checkout')).toBeDisabled();

    await tap(1);
    await tap(1);
    await tap(4);

    expect(screen.getByTestId('cart-count')).toHaveTextContent('3 items');
    expect(screen.getByTestId('cart-line-0')).toHaveTextContent(/Egg with Rice/);
    expect(screen.getByTestId('cart-line-0-qty-value')).toHaveTextContent('2');
    expect(screen.getByTestId('cart-line-0-amount')).toHaveTextContent('₱100.00');
    expect(screen.getByTestId('cart-line-1')).toHaveTextContent(/Iced Tea/);
    expect(screen.getByTestId('cart-total-amount')).toHaveTextContent('₱135.00');
    // SHOW_VAT_BREAKDOWN is off (constants/features.ts): no "VAT included" row.
    expect(screen.queryByTestId('cart-vat')).toBeNull();
    expect(screen.getByTestId('cart-checkout')).toHaveTextContent(/Checkout \(₱135\.00\)/);
    // The card says "Added ✓" after a tap.
    expect(screen.getByTestId('product-tile-4-add')).toHaveTextContent('Added ✓');
  });

  it('never adds an unavailable product', async () => {
    const { products } = seedMenu();
    products[1] = syncProduct({ ...products[1], is_available: false });
    await storeMenu(products);
    await renderSell();

    expect(screen.getByTestId('product-tile-2-body')).toBeDisabled();
    await tap(2);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('edits a line: qty, a 10% line discount and a note; the stepper and remove work too', async () => {
    await storeMenu();
    await renderSell();
    await tap(1);

    await fireEvent.press(screen.getByTestId('cart-line-0-edit'));
    await fireEvent.changeText(screen.getByTestId('line-editor-qty'), '3');
    await fireEvent(screen.getByTestId('line-discount-toggle'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('line-discount-value'), '10');
    await fireEvent.changeText(screen.getByTestId('line-editor-notes'), 'No egg yolk');
    await fireEvent.press(screen.getByTestId('line-editor-save'));

    expect(screen.queryByTestId('line-editor')).toBeNull();
    expect(screen.getByTestId('cart-line-0-qty-value')).toHaveTextContent('3');
    expect(screen.getByTestId('cart-line-0-discount')).toHaveTextContent(/Promo · 10% · −₱15\.00/);
    expect(screen.getByTestId('cart-line-0-notes')).toHaveTextContent(/No egg yolk/);
    expect(screen.getByTestId('cart-line-0-amount')).toHaveTextContent('₱135.00');

    // A discounted line is kept apart: tapping the tile starts a new line.
    await tap(1);
    expect(useCartStore.getState().lines).toHaveLength(2);

    await fireEvent.press(screen.getByTestId('cart-line-1-qty-plus'));
    expect(screen.getByTestId('cart-line-1-qty-value')).toHaveTextContent('2');
    await fireEvent.press(screen.getByTestId('cart-line-1-remove'));
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('refuses a line discount amount above the line total with the server wording', async () => {
    await storeMenu();
    await renderSell();
    await tap(1);

    await fireEvent.press(screen.getByTestId('cart-line-0-edit'));
    await fireEvent(screen.getByTestId('line-discount-toggle'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('line-discount-kind-amount'));
    await fireEvent.changeText(screen.getByTestId('line-discount-value'), '60');
    await fireEvent.press(screen.getByTestId('line-editor-save'));

    expect(screen.getByTestId('line-discount-value-error')).toHaveTextContent("The discount can't be more than ₱50.00.");
    expect(useCartStore.getState().lines[0].discount).toBeNull();
  });

  it('sets and removes the order discount', async () => {
    await storeMenu();
    await renderSell();
    await tap(3);

    await fireEvent.press(screen.getByTestId('cart-order-discount-edit'));
    await fireEvent.press(screen.getByTestId('order-discount-kind-amount'));
    await fireEvent.press(screen.getByTestId('order-discount-type-employee'));
    await fireEvent.changeText(screen.getByTestId('order-discount-value'), '101');
    await fireEvent.press(screen.getByTestId('order-discount-save'));
    expect(screen.getByTestId('order-discount-value-error')).toHaveTextContent("The discount can't be more than ₱100.00.");

    await fireEvent.changeText(screen.getByTestId('order-discount-value'), '10');
    await fireEvent.press(screen.getByTestId('order-discount-save'));
    expect(screen.getByTestId('cart-order-discount')).toHaveTextContent('Employee · ₱10.00 · −₱10.00');
    expect(screen.getByTestId('cart-total-amount')).toHaveTextContent('₱90.00');
    // ₱10 of ₱100 is within a cashier's 10%: no approval.
    expect(screen.queryByTestId('cart-approval-hint')).toBeNull();

    await fireEvent.press(screen.getByTestId('cart-order-discount-edit'));
    await fireEvent.press(screen.getByTestId('order-discount-remove'));
    expect(screen.queryByTestId('cart-order-discount')).toBeNull();
    expect(screen.getByTestId('cart-total-amount')).toHaveTextContent('₱100.00');
  });

  it('says a discount over the cashier’s limit needs a manager at checkout', async () => {
    await storeMenu();
    await renderSell();
    await tap(3);
    await act(async () => useCartStore.getState().setOrderDiscount({ type: 'manual', kind: 'percent', value: 2000 }));

    expect(screen.getByTestId('cart-approval-hint')).toHaveTextContent(/A manager must approve this discount at checkout\./);
  });

  it('attaches a customer from GET /api/v1/customers, and removes them', async () => {
    const { calls } = routeFetch([
      {
        method: 'GET',
        path: '/api/v1/customers',
        reply: () => mockResponse(200, page([makeCustomer()], null, '/api/v1/customers')),
      },
    ]);
    await storeMenu();
    await renderSell();

    await fireEvent.press(screen.getByTestId('cart-customer'));
    await fireEvent.press(await screen.findByTestId('customer-option-12'));

    expect(screen.queryByTestId('customer-picker')).toBeNull();
    expect(screen.getByTestId('cart-customer')).toHaveTextContent(/Maria Santos/);
    expect(useCartStore.getState().customer).toEqual({ id: 12, full_name: 'Maria Santos' });
    expect(calls[0].path).toBe('/api/v1/customers');

    await fireEvent.press(screen.getByTestId('cart-customer'));
    await fireEvent.press(await screen.findByTestId('customer-picker-none'));
    expect(useCartStore.getState().customer).toBeNull();
  });

  it('clears the cart after confirmation', async () => {
    await storeMenu();
    await renderSell();
    await tap(1);
    await tap(4);

    await fireEvent.press(screen.getByTestId('cart-clear'));
    expect(screen.getByTestId('clear-cart-dialog')).toHaveTextContent(/Clear the cart\?/);
    await fireEvent.press(screen.getByTestId('clear-cart-dialog-confirm'));

    expect(useCartStore.getState().lines).toEqual([]);
    expect(screen.getByTestId('cart-empty')).toBeOnTheScreen();
  });

  it('Charge starts checkout: the pending sale ULID is generated and the checkout opens', async () => {
    await storeMenu();
    await renderSell();
    await tap(1);

    await fireEvent.press(screen.getByTestId('cart-checkout'));

    expect(useCartStore.getState().pendingUlid).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(router.push).toHaveBeenCalledWith('/sell/checkout');
  });

  it('shows a rejected sale’s messages on its lines, and locks the cart while an attempt is unconfirmed', async () => {
    await storeMenu();
    await renderSell();
    await tap(1);
    await tap(4);

    await act(async () =>
      useCartStore.getState().showServerErrors({
        lines: { 1: 'Only 2 "Iced Tea" left in stock.' },
        orderDiscount: null,
        customer: null,
        cart: null,
      }),
    );
    expect(screen.getByTestId('cart-line-1-error')).toHaveTextContent('Only 2 "Iced Tea" left in stock.');
    expect(screen.queryByTestId('cart-line-0-error')).toBeNull();
    // A message informs; the server checks again, so Charge stays available.
    expect(screen.getByTestId('cart-checkout')).not.toBeDisabled();

    await act(async () => useCartStore.getState().setAwaitingConfirmation(true));
    expect(screen.getByTestId('cart-awaiting')).toBeOnTheScreen();
    expect(screen.getByTestId('cart-line-0-qty-plus')).toBeDisabled();
    expect(screen.getByTestId('cart-checkout')).toHaveTextContent(/Retry at checkout$/);
    await tap(1);
    expectText('sell-notice', "The last sale attempt isn't confirmed yet. Retry it from checkout before changing the cart.");
  });
});

describe('phones and portrait: a bottom bar opens the cart', () => {
  it('phone portrait: the "View order" bar (count, items, total) opens the cart sheet; rotating to tablet landscape keeps the cart beside the menu', async () => {
    setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height);
    await storeMenu();
    await renderSell();

    expect(screen.queryByTestId('cart-panel-side')).toBeNull();
    expect(screen.getByTestId('cart-bar-text')).toHaveTextContent('0 items');
    expect(screen.getByTestId('cart-bar-total')).toHaveTextContent('₱0.00');

    await tap(1);
    await tap(5);
    expect(screen.getByTestId('cart-bar-count')).toHaveTextContent('2');
    expect(screen.getByTestId('cart-bar-text')).toHaveTextContent('2 items');
    expect(screen.getByTestId('cart-bar-total')).toHaveTextContent('₱70.00');

    await fireEvent.press(screen.getByTestId('cart-bar'));
    const sheet = screen.getByTestId('cart-sheet');
    expect(within(sheet).getByTestId('cart-panel-sheet')).toBeOnTheScreen();
    expect(within(sheet).getByTestId('cart-line-1')).toHaveTextContent(/Bottled Water/);

    await act(async () => setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height));

    expect(screen.queryByTestId('cart-bar')).toBeNull();
    expect(screen.queryByTestId('cart-panel-sheet')).toBeNull();
    expect(screen.getByTestId('cart-panel-side')).toBeOnTheScreen();
    expect(screen.getByTestId('cart-total-amount')).toHaveTextContent('₱70.00');
  });

  it('tablet portrait: the card stays visible under the menu, and the pinned bar\'s Checkout goes straight to checkout', async () => {
    setWindowSize(REFERENCE_SIZES.tabletPortrait.width, REFERENCE_SIZES.tabletPortrait.height);
    await storeMenu();
    await renderSell();
    await tap(4);
    expect(screen.getByTestId('cart-panel-below')).toBeOnTheScreen();
    expect(screen.getByTestId('cart-bar')).toBeOnTheScreen();
    expect(screen.getByTestId('cart-bar-checkout')).toHaveTextContent(/Checkout \(₱/);
    // The card under the menu has no Checkout of its own: the bar has it.
    expect(screen.queryByTestId('cart-checkout')).toBeNull();

    await act(async () =>
      useCartStore.getState().showServerErrors({ lines: { 0: 'Only 0 "Iced Tea" left in stock.' }, orderDiscount: null, customer: null, cart: null }),
    );
    expect(screen.queryByTestId('cart-sheet')).toBeNull();
    expect(screen.getByTestId('cart-line-0-error')).toHaveTextContent('Only 0 "Iced Tea" left in stock.');
    expect(screen.getByTestId('cart-bar-attention')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('cart-bar-checkout'));
    expect(router.push).toHaveBeenCalledWith('/sell/checkout');
  });
});

describe('without `sale.create`', () => {
  it('keeps the read-only menu: no cart, and tiles are not buttons', async () => {
    useSessionStore.getState().setSignedIn(viewerUser, FUTURE);
    await storeMenu();
    await renderSell();

    expect(screen.queryByTestId('cart-panel-side')).toBeNull();
    expect(screen.queryByTestId('cart-bar')).toBeNull();
    expect(screen.getByTestId('product-tile-1-body').props.accessibilityRole).toBeUndefined();
    await tap(1);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });
});
