/**
 * Checkout (contract → Core Sale → App → Checkout, Approval, Submitting,
 * Success) through the real screen, the shared API client (fetch mocked) and
 * the cart store. The idempotency rule is the heart of it: one ULID per sale,
 * reused on every retry until a 201, and only then a new one.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import CheckoutRoute from '@/app/(app)/(pos)/sell/checkout';
import { catalogueRepository } from '@/db/catalogueRepository';
import { REQUEST_TIMEOUT_MS } from '@/services/api';
import { resetCart, useCartStore } from '@/stores/cart';
import { useConnectivityStore } from '@/stores/connectivity';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { cashierUser, mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { mockVatBreakdown } from '@/test-utils/features';
import { seedOpenShift, TEST_SHIFT_ULID } from '@/test-utils/shifts';
import { fillCartWithExampleB, HOT_DOG, makeOrder, PIN_USERS } from '@/test-utils/sale';
import { SERVER_TIME, syncCategory, syncPage, syncProduct } from '@/test-utils/sync';
import { isUlid } from '@/utils/ulid';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const FUTURE = '2099-09-25T01:30:00Z';
const ORDERS = '/api/v1/orders';
const useNetworkState = jest.requireMock('expo-network').useNetworkState as jest.Mock;

type OrderRequestBody = {
  ulid: string;
  items: { product_id: number; qty: number }[];
  payments: unknown[];
  client_total_cents: number;
  discount_authorization: { user_id: number; pin: string } | null;
};

function orderCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method === 'POST' && call.path === ORDERS);
}

function keyOf(call: FetchCall): string {
  return (call.init.headers as Record<string, string>)['Idempotency-Key'];
}

function bodyOf(call: FetchCall): OrderRequestBody {
  return jsonBody(call) as OrderRequestBody;
}

function orderRoute(reply: Route['reply']): Route {
  return { method: 'POST', path: ORDERS, reply };
}

const pinUsersRoute: Route = {
  method: 'GET',
  path: '/api/v1/auth/pin-users',
  reply: () => mockResponse(200, page(PIN_USERS, null, '/api/v1/auth/pin-users')),
};

async function renderCheckout() {
  const result = await renderWithQuery(<CheckoutRoute />);
  await screen.findByTestId('checkout-confirm');
  return result;
}

async function payExampleB() {
  await fireEvent.changeText(screen.getByTestId('checkout-cash'), '200');
  await fireEvent.press(screen.getByTestId('checkout-add-gcash'));
  await fireEvent.changeText(screen.getByTestId('checkout-gcash-0-amount'), '100');
  await fireEvent.changeText(screen.getByTestId('checkout-gcash-0-reference'), '1012345678901');
}

async function payExact() {
  await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
}

async function enterPin(prefix: string, pin: string) {
  for (const digit of pin) await fireEvent.press(screen.getByTestId(`${prefix}-key-${digit}`));
}

/** A banner shows exactly `message` (its icon glyph is part of the element's text content, so match the text node). */
async function expectMessage(testID: string, message: string) {
  const element = await screen.findByTestId(testID);
  expect(within(element).getByText(message)).toBeOnTheScreen();
}

beforeEach(async () => {
  await freshTestDatabase();
  // Phase 6: sales need an open shift on the tablet.
  seedOpenShift();
  useSyncStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  resetCart();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  // A timeout opens the server-reachability breaker: every test starts with the server reachable.
  useConnectivityStore.getState().reset();
  useNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
  (router.back as jest.Mock).mockClear();
});

afterEach(() => {
  resetWindowSize();
  jest.useRealTimers();
});

describe('totals and payments', () => {
  it('with SHOW_VAT_BREAKDOWN on, shows the VAT breakdown of worked example B (same total)', async () => {
    const flag = mockVatBreakdown(true);
    try {
      fillCartWithExampleB();
      routeFetch([]);
      await renderCheckout();

      expect(screen.getByTestId('checkout-total-amount')).toHaveTextContent('₱257.00');
      expect(screen.getByTestId('checkout-vatable-amount')).toHaveTextContent('₱152.12');
      expect(screen.getByTestId('checkout-vat-amount-amount')).toHaveTextContent('₱18.25');
      expect(screen.getByTestId('checkout-vat-exempt-amount')).toHaveTextContent('₱86.63');
    } finally {
      flag.mockRestore();
    }
  });

  it('shows the breakdown of worked example B, the live amount due or change, and blocks a short payment', async () => {
    fillCartWithExampleB();
    routeFetch([]);
    await renderCheckout();

    expect(screen.getByTestId('checkout-subtotal-amount')).toHaveTextContent('₱275.00');
    expect(screen.getByTestId('checkout-line-discounts-amount')).toHaveTextContent('−₱8.00');
    expect(screen.getByTestId('checkout-order-discount-amount')).toHaveTextContent('−₱10.00');
    expect(screen.getByTestId('checkout-total-amount')).toHaveTextContent('₱257.00');
    // SHOW_VAT_BREAKDOWN is off (constants/features.ts): no VAT block.
    expect(screen.queryByTestId('checkout-vat')).toBeNull();

    expect(screen.getByTestId('checkout-due')).toHaveTextContent('₱257.00');
    expect(screen.getByTestId('checkout-confirm')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('checkout-cash'), '200');
    expect(screen.getByTestId('checkout-due')).toHaveTextContent('₱57.00');
    expect(screen.getByTestId('checkout-confirm')).toBeDisabled();

    // Split tender: the GCash row is prefilled with what is still owed.
    await fireEvent.press(screen.getByTestId('checkout-add-gcash'));
    expect(screen.getByTestId('checkout-gcash-0-amount').props.value).toBe('57.00');
    await fireEvent.changeText(screen.getByTestId('checkout-gcash-0-amount'), '100');
    expect(screen.getByTestId('checkout-change')).toHaveTextContent('₱43.00');
    expect(screen.getByTestId('checkout-confirm')).not.toBeDisabled();

    // GCash alone above the total is refused.
    await fireEvent.changeText(screen.getByTestId('checkout-gcash-0-amount'), '300');
    await expectMessage('checkout-gcash-over', "GCash can't be more than the total.");
    expect(screen.getByTestId('checkout-confirm')).toBeDisabled();
  });

  it('quick amounts set the cash handed over; Exact covers what GCash leaves', async () => {
    fillCartWithExampleB();
    routeFetch([]);
    await renderCheckout();

    await fireEvent.press(screen.getByTestId('checkout-cash-50000'));
    expect(screen.getByTestId('checkout-cash').props.value).toBe('500.00');
    expect(screen.getByTestId('checkout-change')).toHaveTextContent('₱243.00');

    await fireEvent.press(screen.getByTestId('checkout-add-gcash'));
    await fireEvent.changeText(screen.getByTestId('checkout-gcash-0-amount'), '100');
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    expect(screen.getByTestId('checkout-cash').props.value).toBe('157.00');
    expect(screen.getByTestId('checkout-change')).toHaveTextContent('₱0.00');
  });

  it('requires the GCash reference before sending anything', async () => {
    fillCartWithExampleB();
    const { calls } = routeFetch([]);
    await renderCheckout();

    await fireEvent.press(screen.getByTestId('checkout-add-gcash'));
    await fireEvent.changeText(screen.getByTestId('checkout-gcash-0-amount'), '257');
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    expect(screen.getByTestId('checkout-gcash-0-reference-error')).toHaveTextContent('Enter the GCash reference number.');
    expect(orderCalls(calls)).toHaveLength(0);
  });
});

describe('submitting', () => {
  it('sends worked example B with Idempotency-Key = ulid, then shows the change due; a new sale gets a new ULID', async () => {
    fillCartWithExampleB();
    useCartStore.getState().setCustomer({ id: 12, full_name: 'Maria Santos' });
    const pendingUlid = useCartStore.getState().beginCheckout();
    const { calls } = routeFetch([orderRoute(() => mockResponse(201, { data: makeOrder() }))]);
    await renderCheckout();

    await payExampleB();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    const [call] = orderCalls(calls);
    expect(keyOf(call)).toBe(pendingUlid);
    expect(jsonBody(call)).toEqual({
      ulid: pendingUlid,
      customer_id: 12,
      notes: null,
      // Table Number (Core Sale revision 2): none typed.
      table_no: null,
      items: [
        { product_id: 4, qty: 1, discount: { type: 'promo', kind: 'percent', value: 1000 }, notes: 'No ketchup', sc_pwd: false },
        { product_id: 11, qty: 2, discount: null, notes: null, sc_pwd: false },
        { product_id: 9, qty: 3, discount: null, notes: null, sc_pwd: false },
      ],
      discount: { type: 'promo', kind: 'amount', value: 1000 },
      payments: [
        { method: 'cash', amount_cents: 20000, reference_no: null },
        { method: 'gcash', amount_cents: 10000, reference_no: '1012345678901' },
      ],
      client_total_cents: 25700,
      discount_authorization: null,
      // Phase 6: the tablet's open shift.
      shift_ulid: TEST_SHIFT_ULID,
      // Senior Citizen / PWD Discount: none on this sale.
      sc_pwd: null,
    });

    expect(screen.getByTestId('sale-invoice')).toHaveTextContent('INV-MAIN-00000042');
    expect(screen.getByTestId('sale-queue')).toHaveTextContent('#17');
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('₱257.00');
    expect(screen.getByTestId('sale-tendered-amount')).toHaveTextContent('₱300.00');
    expect(screen.getByTestId('sale-change')).toHaveTextContent('₱43.00');

    // The 201 ended the sale: an empty cart, and no pending ULID.
    expect(useCartStore.getState()).toMatchObject({ lines: [], pendingUlid: null, customer: null });
    await fireEvent.press(screen.getByTestId('sale-new'));
    expect(router.back).toHaveBeenCalled();

    // The next sale gets a new ULID.
    let next = '';
    await act(async () => {
      useCartStore.getState().addProduct(HOT_DOG);
      next = useCartStore.getState().beginCheckout();
    });
    expect(isUlid(next)).toBe(true);
    expect(next).not.toBe(pendingUlid);
  });

  it('after a timeout: shows "We couldn\'t confirm the sale. Retry.", locks the cart, and retries with the same ULID and body', async () => {
    jest.useFakeTimers();
    fillCartWithExampleB();
    let answer: 'hang' | 'created' = 'hang';
    const { calls } = routeFetch([
      orderRoute(
        (call) =>
          answer === 'created'
            ? mockResponse(201, { data: makeOrder() })
            : new Promise<Response>((_resolve, reject) => {
                call.init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
              }),
      ),
    ]);
    await renderCheckout();
    await payExampleB();

    await fireEvent.press(screen.getByTestId('checkout-confirm'));
    await act(async () => {
      jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    });

    await expectMessage('checkout-banner', "We couldn't confirm the sale. Retry.");
    expect(useCartStore.getState().awaitingConfirmation).toBe(true);
    // The payments and the cart can't change: the retry must match the first attempt.
    expect(screen.getByTestId('checkout-cash').props.editable).toBe(false);
    expect(useCartStore.getState().addProduct(HOT_DOG)).toBe('locked');
    expect(screen.getByTestId('checkout-confirm')).toHaveTextContent(/Retry sale$/);

    answer = 'created';
    await fireEvent.press(screen.getByTestId('checkout-retry'));

    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    const [first, second] = orderCalls(calls);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(bodyOf(second)).toEqual(bodyOf(first));
    expect(isUlid(bodyOf(first).ulid)).toBe(true);
    expect(useCartStore.getState().awaitingConfirmation).toBe(false);
  });

  it('after a network error the retry keeps the ULID too, and the payments survive leaving checkout', async () => {
    fillCartWithExampleB();
    let fail = true;
    const { calls } = routeFetch([
      orderRoute(() => (fail ? Promise.reject(new TypeError('Network request failed')) : mockResponse(201, { data: makeOrder() }))),
    ]);
    const first = await renderCheckout();
    await payExampleB();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));
    await expectMessage('checkout-banner', "We couldn't confirm the sale. Retry.");

    // The cashier goes back to the Sell screen and returns: the payments are still there.
    await first.unmount();
    await renderCheckout();
    expect(screen.getByTestId('checkout-cash').props.value).toBe('200');

    fail = false;
    await fireEvent.press(screen.getByTestId('checkout-confirm'));
    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    const [attempt, retry] = orderCalls(calls);
    expect(keyOf(retry)).toBe(keyOf(attempt));
    expect(bodyOf(retry)).toEqual(bodyOf(attempt));
  });

  it('a stock 422 goes back to the cart with the message on those lines; the corrected sale keeps the ULID', async () => {
    fillCartWithExampleB();
    let reply: 'stock' | 'created' = 'stock';
    const { calls } = routeFetch([
      orderRoute(() =>
        reply === 'stock'
          ? mockResponse(422, {
              message: 'Only 2 "Iced Tea" left in stock.',
              errors: { 'items.2.qty': ['Only 2 "Iced Tea" left in stock.'] },
            })
          : mockResponse(201, { data: makeOrder() }),
      ),
    ]);
    const view = await renderCheckout();
    await payExampleB();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    const { lines, lineErrors, pendingUlid } = useCartStore.getState();
    expect(lineErrors).toEqual({ [lines[2].key]: 'Only 2 "Iced Tea" left in stock.' });
    expect(pendingUlid).toBe(bodyOf(orderCalls(calls)[0]).ulid);

    // The cashier lowers the Iced Tea to 2 and charges again.
    await view.unmount();
    useCartStore.getState().setQty(lines[2].key, 2);
    reply = 'created';
    await renderCheckout();
    await fireEvent.changeText(screen.getByTestId('checkout-cash'), '200');
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    const [first, second] = orderCalls(calls);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(bodyOf(second).items[2]).toMatchObject({ product_id: 9, qty: 2 });
    // ₱240.00 − ₱8.00 line discount − ₱10.00 order discount.
    expect(bodyOf(second).client_total_cents).toBe(22200);
  });

  it('a checksum 422 syncs the menu, re-prices the cart and shows the message; the next attempt keeps the ULID', async () => {
    await catalogueRepository.replaceCatalogue(
      {
        categories: [syncCategory({ id: 1, name: 'Breakfast' })],
        products: [syncProduct({ id: 4, category_id: 1, name: 'Hot Dog', sku: 'BRK-002', price_cents: 8000 })],
      },
      { cursor: 'c1', apiOrigin: 'http://192.168.1.50:8000', serverTime: SERVER_TIME },
    );
    useCartStore.getState().addProduct(HOT_DOG);
    const message = 'The menu has changed since your last sync. Review the new total.';
    let reply: 'checksum' | 'created' = 'checksum';
    const { calls } = routeFetch([
      orderRoute(() =>
        reply === 'checksum'
          ? mockResponse(422, { message, errors: { client_total_cents: [message] } })
          : mockResponse(201, { data: makeOrder({ total_cents: 8500 }) }),
      ),
      {
        method: 'GET',
        path: '/api/v1/sync/catalogue',
        reply: () =>
          mockResponse(
            200,
            syncPage({
              products: [syncProduct({ id: 4, category_id: 1, name: 'Hot Dog', sku: 'BRK-002', price_cents: 8500 })],
              meta: { full: false },
            }),
          ),
      },
    ]);
    await renderCheckout();
    await payExact();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await expectMessage('checkout-banner', message);
    await waitFor(() => expect(screen.getByTestId('checkout-total-amount')).toHaveTextContent('₱85.00'));
    const syncCall = calls.find((call) => call.path === '/api/v1/sync/catalogue');
    expect(syncCall?.query.get('cursor')).toBe('c1');
    expect(useCartStore.getState().lines[0].product.price_cents).toBe(8500);
    // ₱80.00 cash is now short of ₱85.00.
    expect(screen.getByTestId('checkout-due')).toHaveTextContent('₱5.00');

    reply = 'created';
    await payExact();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));
    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    const [first, second] = orderCalls(calls);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(bodyOf(second).client_total_cents).toBe(8500);
  });

  it('a 409 "still being processed" is retried shortly with the same ULID', async () => {
    useCartStore.getState().addProduct(HOT_DOG);
    let attempts = 0;
    const { calls } = routeFetch([
      orderRoute(() => {
        attempts += 1;
        return attempts === 1
          ? mockResponse(409, { message: 'This request is still being processed. Try again in a moment.' })
          : mockResponse(201, { data: makeOrder({ total_cents: 8000, tendered_cents: 8000, change_cents: 0 }) });
      }),
    ]);
    await renderCheckout();
    await payExact();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    expect(await screen.findByTestId('checkout-banner')).toHaveTextContent(/still being processed/);
    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    const [first, second] = orderCalls(calls);
    expect(keyOf(second)).toBe(keyOf(first));
  });

  it('shows any other error (e.g. 403) with the server message and keeps the cart', async () => {
    useCartStore.getState().addProduct(HOT_DOG);
    routeFetch([orderRoute(() => mockResponse(403, { message: 'This action is unauthorized.' }))]);
    await renderCheckout();
    await payExact();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await expectMessage('checkout-banner', 'This action is unauthorized.');
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().awaitingConfirmation).toBe(false);
  });

  // Offline Sales (Phase 5) replaced the Phase 3 gate ("Sales need a connection…"): offline sales are
  // saved on the tablet (OfflineCheckout.test.tsx), except on a tablet that never registered.
  it('offline on a tablet that never registered: Confirm is disabled with "Connect once to set up offline sales."', async () => {
    useNetworkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    useCartStore.getState().addProduct(HOT_DOG);
    const { calls } = routeFetch([]);
    await renderCheckout();
    await payExact();

    await expectMessage('checkout-offline', 'Connect once to set up offline sales.');
    expect(screen.getByTestId('checkout-confirm')).toBeDisabled();
    expect(calls).toHaveLength(0);
  });
});

describe('409 "already used for a different request" (Q-004): the sale is looked up', () => {
  const reused = () => mockResponse(409, { message: 'This Idempotency-Key was already used for a different request.' });

  function lookups(calls: FetchCall[]): FetchCall[] {
    return calls.filter((call) => call.method === 'GET' && call.path.startsWith(`${ORDERS}/`));
  }

  it('200: shows the success screen from that Order with the note, then clears the cart and the ULID', async () => {
    fillCartWithExampleB();
    const pendingUlid = useCartStore.getState().beginCheckout();
    const { calls } = routeFetch([
      orderRoute(reused),
      {
        method: 'GET',
        path: `${ORDERS}/${pendingUlid}`,
        reply: () => mockResponse(200, { data: makeOrder({ ulid: pendingUlid, tendered_cents: 50000, change_cents: 24300 }) }),
      },
    ]);
    await renderCheckout();
    await payExampleB();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    await expectMessage('sale-note', 'An earlier attempt already completed this sale.');
    // The earlier sale's own figures, not the cart's.
    expect(screen.getByTestId('sale-tendered-amount')).toHaveTextContent('₱500.00');
    expect(screen.getByTestId('sale-change')).toHaveTextContent('₱243.00');
    expect(lookups(calls)).toHaveLength(1);
    expect(useCartStore.getState()).toMatchObject({ lines: [], pendingUlid: null, awaitingConfirmation: false });
  });

  it.each([404, 403])('%i: says the sale was already recorded; the cart stays locked with its ULID', async (status) => {
    fillCartWithExampleB();
    const pendingUlid = useCartStore.getState().beginCheckout();
    routeFetch([
      orderRoute(reused),
      {
        method: 'GET',
        path: `${ORDERS}/${pendingUlid}`,
        reply: () => mockResponse(status, { message: status === 404 ? 'Resource not found.' : 'This action is unauthorized.' }),
      },
    ]);
    await renderCheckout();
    await payExampleB();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await expectMessage('checkout-banner', 'This sale was already recorded. Check Orders before charging again.');
    expect(screen.queryByTestId('checkout-retry')).toBeNull();
    expect(screen.queryByTestId('sale-complete')).toBeNull();
    expect(useCartStore.getState()).toMatchObject({ pendingUlid, awaitingConfirmation: true });
    expect(useCartStore.getState().lines).toHaveLength(3);
    expect(useCartStore.getState().addProduct(HOT_DOG)).toBe('locked');
    // Clear is still allowed (the Sell screen asks first, with its warning).
    await act(async () => useCartStore.getState().clear());
    expect(useCartStore.getState()).toMatchObject({ lines: [], pendingUlid: null, awaitingConfirmation: false });
  });

  it('network error on the lookup: keeps the message and Retry repeats the lookup', async () => {
    fillCartWithExampleB();
    const pendingUlid = useCartStore.getState().beginCheckout();
    let lookupFails = true;
    const { calls } = routeFetch([
      orderRoute(reused),
      {
        method: 'GET',
        path: `${ORDERS}/${pendingUlid}`,
        reply: () =>
          lookupFails ? Promise.reject(new TypeError('Network request failed')) : mockResponse(200, { data: makeOrder({ ulid: pendingUlid }) }),
      },
    ]);
    await renderCheckout();
    await payExampleB();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await expectMessage('checkout-banner', 'This Idempotency-Key was already used for a different request.');
    expect(useCartStore.getState()).toMatchObject({ pendingUlid, awaitingConfirmation: true });

    lookupFails = false;
    await fireEvent.press(screen.getByTestId('checkout-retry'));

    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    await expectMessage('sale-note', 'An earlier attempt already completed this sale.');
    // Retry repeated the lookup; it never re-sent the sale.
    expect(lookups(calls)).toHaveLength(2);
    expect(orderCalls(calls)).toHaveLength(1);
    expect(useCartStore.getState().pendingUlid).toBeNull();
  });
});

describe('manager approval', () => {
  /** Hot Dog ₱80.00 with a 20% order discount: ₱16.00, over a cashier's 10%. */
  function cartOverCashierLimit() {
    useCartStore.getState().addProduct(HOT_DOG);
    useCartStore.getState().setOrderDiscount({ type: 'manual', kind: 'percent', value: 2000 });
  }

  it('asks before sending when the app can tell; lists only approvers who can cover it; resubmits with the same ULID', async () => {
    cartOverCashierLimit();
    let pinReply: 'wrong' | 'ok' = 'wrong';
    const { calls } = routeFetch([
      pinUsersRoute,
      orderRoute(() =>
        pinReply === 'wrong'
          ? mockResponse(422, { message: 'Incorrect PIN.', errors: { 'discount_authorization.pin': ['Incorrect PIN.'] } })
          : mockResponse(201, { data: makeOrder({ authorized_by: { id: 1, name: 'Olga Owner' } }) }),
      ),
    ]);
    await renderCheckout();
    await payExact();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    // No request yet: the approver picker opens first.
    const dialog = await screen.findByTestId('approval-dialog');
    expect(orderCalls(calls)).toHaveLength(0);
    await waitFor(() => expect(within(dialog).getByTestId('approver-1')).toBeOnTheScreen());
    // Marco's 15% can't cover 20%, and Carla can't approve at all.
    expect(within(dialog).queryByTestId('approver-2')).toBeNull();
    expect(within(dialog).queryByTestId('approver-3')).toBeNull();

    await fireEvent.press(within(dialog).getByTestId('approver-1'));
    expect(screen.getByTestId('approval-submit')).toBeDisabled();
    await enterPin('approval-pin', '1111');
    await fireEvent.press(screen.getByTestId('approval-submit'));

    expect(await screen.findByTestId('approval-pin-error')).toHaveTextContent('Incorrect PIN.');
    expect(screen.getByTestId('approval-pin-dots').props.accessibilityLabel).toMatch(/0 of 4 to 6 digits/);

    pinReply = 'ok';
    await enterPin('approval-pin', '2468');
    await fireEvent.press(screen.getByTestId('approval-submit'));

    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    const [first, second] = orderCalls(calls);
    expect(bodyOf(first).discount_authorization).toEqual({ user_id: 1, pin: '1111' });
    expect(bodyOf(second).discount_authorization).toEqual({ user_id: 1, pin: '2468' });
    expect(keyOf(second)).toBe(keyOf(first));
    expect(bodyOf(second).ulid).toBe(bodyOf(first).ulid);
  });

  it('opens the picker when the server asks (422 on discount_authorization) and resubmits with the same ULID', async () => {
    // A manager's own limit covers it, so the app sends it; the server still asks for approval.
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    cartOverCashierLimit();
    let attempts = 0;
    const { calls } = routeFetch([
      pinUsersRoute,
      orderRoute(() => {
        attempts += 1;
        return attempts === 1
          ? mockResponse(422, {
              message: 'A manager must approve this discount.',
              errors: { discount_authorization: ['A manager must approve this discount.'] },
            })
          : mockResponse(201, { data: makeOrder() });
      }),
    ]);
    await renderCheckout();
    await payExact();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    const dialog = await screen.findByTestId('approval-dialog');
    expect(dialog).toHaveTextContent(/A manager must approve this discount\./);
    await waitFor(() => expect(screen.getByTestId('approver-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('approver-1'));
    await enterPin('approval-pin', '2468');
    await fireEvent.press(screen.getByTestId('approval-submit'));

    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    const [first, second] = orderCalls(calls);
    expect(bodyOf(first).discount_authorization).toBeNull();
    expect(bodyOf(second).discount_authorization).toEqual({ user_id: 1, pin: '2468' });
    expect(keyOf(second)).toBe(keyOf(first));
  });

  it('shows a locked PIN (429) and an approver who can\'t approve (422) in the dialog', async () => {
    cartOverCashierLimit();
    let reply: 'locked' | 'rejected' = 'locked';
    routeFetch([
      pinUsersRoute,
      orderRoute(() =>
        reply === 'locked'
          ? mockResponse(429, { message: 'Too many incorrect PIN attempts. Try again in 12 minutes.' })
          : mockResponse(422, {
              message: "This person can't approve this discount.",
              errors: { 'discount_authorization.user_id': ["This person can't approve this discount."] },
            }),
      ),
    ]);
    await renderCheckout();
    await payExact();
    await fireEvent.press(screen.getByTestId('checkout-confirm'));
    await waitFor(() => expect(screen.getByTestId('approver-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('approver-1'));
    await enterPin('approval-pin', '2468');
    await fireEvent.press(screen.getByTestId('approval-submit'));

    expect(await screen.findByTestId('approval-pin-error')).toHaveTextContent(
      'Too many incorrect PIN attempts. Try again in 12 minutes.',
    );

    reply = 'rejected';
    await enterPin('approval-pin', '2468');
    await fireEvent.press(screen.getByTestId('approval-submit'));
    await expectMessage('approval-error', "This person can't approve this discount.");
  });
});

describe('layout', () => {
  it('tablet landscape: the summary beside the payments; phone portrait: one column; rotation keeps the typed cash', async () => {
    fillCartWithExampleB();
    routeFetch([]);
    await renderCheckout();
    expect(screen.getByTestId('checkout-two-pane')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('checkout-cash'), '300');

    await act(async () => setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height));

    expect(screen.getByTestId('checkout-one-column')).toBeOnTheScreen();
    expect(screen.getByTestId('checkout-cash').props.value).toBe('300');
    expect(screen.getByTestId('checkout-change')).toHaveTextContent('₱43.00');
  });

  it('shows "Nothing to charge" with an empty cart', async () => {
    routeFetch([]);
    await renderWithQuery(<CheckoutRoute />);
    expect(await screen.findByTestId('checkout-empty')).toHaveTextContent(/Nothing to charge/);
  });
});
