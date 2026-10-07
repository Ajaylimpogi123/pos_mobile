/**
 * Senior Citizen / PWD Discount on the Sell screen and at checkout
 * (docs/api-contract.md → Senior Citizen / PWD Discount → Device rules):
 * the SC/PWD sheet (persons with their ID numbers, the mode, the diners, the
 * VAT exempt checkbox unticked by default, ticked lines), no double
 * discount (confirm, then remove), the SC/PWD chip and totals, `sc_pwd` in
 * `POST /orders` and in the offline sale, no approval step, and the
 * server's 422s on their fields.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import CheckoutRoute from '@/app/(app)/(pos)/sell/checkout';
import SellRoute from '@/app/(app)/(pos)/sell/index';
import { catalogueRepository } from '@/db/catalogueRepository';
import { offlineRepository } from '@/db/offlineRepository';
import { resetPrintingForTests, whenPrintQueueIdle } from '@/printing/printActions';
import { getPrintTransport } from '@/printing/transport';
import type { OfflineOrder, ScPwdRequest } from '@/services/types';
import { resetCart, useCartStore } from '@/stores/cart';
import { useConnectivityStore } from '@/stores/connectivity';
import { useDeviceStore } from '@/stores/device';
import { useOfflineStore } from '@/stores/offline';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { requestOutboxSync } from '@/sync/outboxSync';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { decodeEscPos } from '@/test-utils/escpos';
import { createFakeTransport, makePrintConfig, type FakeTransport } from '@/test-utils/printing';
import { cartProduct, makeScPwdOrder } from '@/test-utils/sale';
import { seedOpenShift, TEST_SHIFT_ULID } from '@/test-utils/shifts';
import { SERVER_TIME, seedMenu } from '@/test-utils/sync';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

jest.mock('@/sync/outboxSync', () => ({
  ...jest.requireActual<typeof import('@/sync/outboxSync')>('@/sync/outboxSync'),
  requestOutboxSync: jest.fn(async () => ({ outcome: 'offline' })),
}));

jest.setTimeout(45_000);

const FUTURE = '2099-09-25T01:30:00Z';
const ORDERS = '/api/v1/orders';
const ORIGIN = 'http://192.168.1.50:8000';
const network = jest.requireMock('expo-network') as { useNetworkState: jest.Mock; getNetworkStateAsync: jest.Mock };
let fake: FakeTransport;

/** Example D's products. */
const MEAL = cartProduct({ id: 1, category_id: 2, name: 'Meal', price_cents: 25000 });
const TEA = cartProduct({ id: 4, category_id: 3, name: 'Iced Tea', price_cents: 4500 });
const MEAL_B = cartProduct({ id: 3, category_id: 2, name: 'Meal B', price_cents: 25000 });

const SENIOR: ScPwdRequest = { mode: 'items', persons: [{ type: 'senior_citizen', id_no: 'OSCA-12345' }], diners: null, vat_exempt: true };

function setOnline(online: boolean) {
  const state = online
    ? { isConnected: true, isInternetReachable: true, type: 'WIFI' }
    : { isConnected: false, isInternetReachable: false, type: 'NONE' };
  network.useNetworkState.mockReturnValue(state);
  network.getNetworkStateAsync.mockResolvedValue(state);
}

function orderCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method === 'POST' && call.path === ORDERS);
}

/** Example D in the cart: Meal and Iced Tea marked for one senior, VAT exempt. */
function fillExampleD(scPwd: ScPwdRequest = SENIOR) {
  const cart = useCartStore.getState();
  cart.addProduct(MEAL);
  cart.addProduct(TEA);
  cart.addProduct(MEAL_B);
  const [meal, tea] = useCartStore.getState().lines.map((line) => line.key);
  useCartStore.getState().applyScPwd(scPwd, [meal, tea]);
}

async function storeMenu() {
  await catalogueRepository.replaceCatalogue(seedMenu(), { cursor: 'c1', apiOrigin: ORIGIN, serverTime: SERVER_TIME });
}

async function renderSell() {
  const result = await renderWithQuery(<SellRoute />);
  await waitFor(() => expect(screen.queryByTestId('sell-loading')).toBeNull());
  return result;
}

async function renderCheckout() {
  const result = await renderWithQuery(<CheckoutRoute />);
  await screen.findByTestId('checkout-confirm');
  return result;
}

async function settlePrinting() {
  await act(async () => {
    await whenPrintQueueIdle();
  });
}

beforeEach(async () => {
  await freshTestDatabase();
  seedOpenShift();
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  usePrintingStore.getState().setConfig(makePrintConfig());
  useSyncStore.getState().reset();
  useDeviceStore.getState().reset();
  useOfflineStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  resetCart();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  useConnectivityStore.getState().reset();
  setOnline(true);
  fake = createFakeTransport();
  (getPrintTransport as jest.Mock).mockReturnValue(fake.transport);
  (requestOutboxSync as jest.Mock).mockClear();
});

afterEach(async () => {
  await settlePrinting();
  jest.useRealTimers();
});

describe('the SC/PWD sheet from the cart', () => {
  it('checks the draft, asks before removing the conflicting discounts, then shows the chip and the totals', async () => {
    await storeMenu();
    routeFetch([]);
    await renderSell();
    await fireEvent.press(screen.getByTestId('product-tile-1-body'));
    await fireEvent.press(screen.getByTestId('product-tile-4-body'));
    const [egg] = useCartStore.getState().lines;
    useCartStore.getState().updateLine(egg.key, { qty: 1, discount: { type: 'promo', kind: 'percent', value: 1000 }, notes: null });
    useCartStore.getState().setOrderDiscount({ type: 'promo', kind: 'amount', value: 500 });

    await fireEvent.press(screen.getByTestId('cart-sc-pwd-edit'));
    expect(await screen.findByTestId('sc-pwd-sheet')).toBeOnTheScreen();
    // VAT exempt is unticked by default, with the contract's hint.
    expect(screen.getByTestId('sc-pwd-vat-exempt').props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText('Remove the 12% VAT before the 20% discount')).toBeOnTheScreen();

    // Apply with nothing filled in: the ID number is required and a line must be ticked.
    await fireEvent.press(screen.getByTestId('sc-pwd-apply'));
    expect(screen.getByTestId('sc-pwd-person-0-id-error')).toHaveTextContent('Enter the OSCA or PWD ID number.');
    expect(screen.getByTestId('sc-pwd-lines-error')).toHaveTextContent('Tick the items for the senior citizen or PWD.');

    await fireEvent.changeText(screen.getByTestId('sc-pwd-person-0-id'), 'OSCA-12345');
    await fireEvent.press(screen.getByTestId('sc-pwd-line-0'));
    await fireEvent.press(screen.getByTestId('sc-pwd-apply'));

    // The Egg with Rice line has a discount, and there is an order discount: confirm removing them.
    const confirm = await screen.findByTestId('sc-pwd-conflicts');
    expect(within(confirm).getByText(/the order discount and 1 line discount are removed/)).toBeOnTheScreen();
    expect(useCartStore.getState().scPwd).toBeNull();
    await fireEvent.press(screen.getByTestId('sc-pwd-conflicts-confirm'));

    await waitFor(() => expect(useCartStore.getState().scPwd).not.toBeNull());
    expect(useCartStore.getState().orderDiscount).toBeNull();
    expect(useCartStore.getState().lines[0].discount).toBeNull();
    expect(screen.getByTestId('cart-line-0-sc-pwd')).toBeOnTheScreen();
    expect(screen.queryByTestId('cart-line-1-sc-pwd')).toBeNull();
    expect(screen.getByTestId('cart-sc-pwd')).toHaveTextContent('Senior citizen · Their items');
    // Not VAT exempt: only the 20% (₱50.00 × 20% = ₱10.00).
    expect(screen.queryByTestId('cart-sc-pwd-vat')).toBeNull();
    expect(screen.getByTestId('cart-sc-pwd-discount-amount')).toHaveTextContent('−₱10.00');
    expect(screen.getByTestId('cart-total-amount')).toHaveTextContent('₱75.00');
    // The order discount is disabled while SC/PWD is set.
    expect(screen.getByTestId('cart-order-discount-edit')).toBeDisabled();
    expect(screen.queryByTestId('cart-approval-hint')).toBeNull();

    // Edit: tick VAT exempt. VAT exempted −₱5.36, SC/PWD −₱8.93.
    await fireEvent.press(screen.getByTestId('cart-sc-pwd-edit'));
    await fireEvent.press(await screen.findByTestId('sc-pwd-vat-exempt'));
    await fireEvent.press(screen.getByTestId('sc-pwd-apply'));
    await waitFor(() => expect(screen.getByTestId('cart-sc-pwd-vat-amount')).toHaveTextContent('−₱5.36'));
    expect(screen.getByTestId('cart-sc-pwd-discount-amount')).toHaveTextContent('−₱8.93');
    expect(screen.getByTestId('cart-total-amount')).toHaveTextContent('₱70.71');
  });

  it('a marked line (any line of a shared meal) hides its discount fields; the diners stepper starts at the persons count', async () => {
    await storeMenu();
    routeFetch([]);
    await renderSell();
    await fireEvent.press(screen.getByTestId('product-tile-1-body'));
    await fireEvent.press(screen.getByTestId('product-tile-4-body'));
    const [egg] = useCartStore.getState().lines;
    useCartStore.getState().applyScPwd({ ...SENIOR, vat_exempt: false }, [egg.key]);

    await fireEvent.press(await screen.findByTestId('cart-line-0-edit'));
    expect(screen.getByTestId('line-editor-sc-pwd-lock')).toHaveTextContent(/SC\/PWD item: no other discount/);
    await fireEvent.press(screen.getByTestId('line-editor-cancel'));
    await fireEvent.press(screen.getByTestId('cart-line-1-edit'));
    expect(screen.queryByTestId('line-editor-sc-pwd-lock')).toBeNull();
    await fireEvent.press(screen.getByTestId('line-editor-cancel'));

    // Shared meal: two persons, the diners follow.
    await fireEvent.press(screen.getByTestId('cart-sc-pwd-edit'));
    await fireEvent.press(await screen.findByTestId('sc-pwd-mode-headcount'));
    await fireEvent.press(screen.getByTestId('sc-pwd-add-person'));
    await fireEvent.press(screen.getByTestId('sc-pwd-add-person'));
    expect(screen.getByTestId('sc-pwd-diners-stepper-value')).toHaveTextContent('3');
    expect(screen.getByTestId('sc-pwd-diners-stepper-minus')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('sc-pwd-person-2-remove'));
    await fireEvent.press(screen.getByTestId('sc-pwd-person-1-pwd'));
    await fireEvent.changeText(screen.getByTestId('sc-pwd-person-1-id'), 'OSCA-12345');
    await fireEvent.press(screen.getByTestId('sc-pwd-apply'));
    // The same ID twice.
    expect(screen.getByTestId('sc-pwd-person-1-id-error')).toHaveTextContent('This ID number is already on this sale.');
    await fireEvent.changeText(screen.getByTestId('sc-pwd-person-1-id'), 'PWD-0099');
    await fireEvent.press(screen.getByTestId('sc-pwd-apply'));

    await waitFor(() => expect(useCartStore.getState().scPwd).toMatchObject({ mode: 'headcount', diners: 3 }));
    expect(useCartStore.getState().scPwd?.persons).toEqual([
      { type: 'senior_citizen', id_no: 'OSCA-12345' },
      { type: 'pwd', id_no: 'PWD-0099' },
    ]);
    expect(screen.queryByTestId('cart-line-0-sc-pwd')).toBeNull();
    await fireEvent.press(screen.getByTestId('cart-line-1-edit'));
    expect(screen.getByTestId('line-editor-sc-pwd-lock')).toHaveTextContent(/Shared meal with SC\/PWD: no other discount/);
  });
});

describe('checkout', () => {
  it('online: sends sc_pwd and items[].sc_pwd, with no approval step (SC/PWD is above the cashier\'s 10% limit)', async () => {
    fillExampleD();
    const { calls } = routeFetch([
      { method: 'POST', path: ORDERS, reply: () => mockResponse(201, { data: makeScPwdOrder(true) }) },
    ]);
    await renderCheckout();

    expect(screen.getByTestId('checkout-sc-pwd')).toHaveTextContent('Senior citizen · Their items · VAT exempt');
    expect(screen.getByTestId('checkout-line-0-sc-pwd')).toBeOnTheScreen();
    expect(screen.getByTestId('checkout-sc-pwd-vat-amount')).toHaveTextContent('−₱31.61');
    expect(screen.getByTestId('checkout-sc-pwd-discount-amount')).toHaveTextContent('−₱52.68');
    expect(screen.getByTestId('checkout-total-amount')).toHaveTextContent('₱460.71');
    // SHOW_VAT_BREAKDOWN is off: the VAT exempted deduction stays, the VAT breakdown is hidden.
    expect(screen.queryByTestId('checkout-vat')).toBeNull();

    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));
    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();

    expect(screen.queryByTestId('approval-dialog')).toBeNull();
    expect(calls.some((call) => call.path === '/api/v1/auth/pin-users')).toBe(false);
    const [call] = orderCalls(calls);
    expect(jsonBody(call)).toMatchObject({
      items: [
        { product_id: 1, qty: 1, discount: null, sc_pwd: true },
        { product_id: 4, qty: 1, discount: null, sc_pwd: true },
        { product_id: 3, qty: 1, discount: null, sc_pwd: false },
      ],
      discount: null,
      client_total_cents: 46071,
      discount_authorization: null,
      sc_pwd: { mode: 'items', persons: [{ type: 'senior_citizen', id_no: 'OSCA-12345' }], diners: null, vat_exempt: true },
    });
    // The success screen clears the cart, SC/PWD included.
    expect(useCartStore.getState().scPwd).toBeNull();
  });

  it('opens the sheet from checkout too', async () => {
    fillExampleD();
    routeFetch([]);
    await renderCheckout();
    await fireEvent.press(screen.getByTestId('checkout-sc-pwd-edit'));
    expect(await screen.findByTestId('sc-pwd-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('sc-pwd-person-0-id').props.value).toBe('OSCA-12345');
    await fireEvent.press(screen.getByTestId('sc-pwd-remove'));
    await waitFor(() => expect(useCartStore.getState().scPwd).toBeNull());
    expect(screen.getByTestId('checkout-sc-pwd')).toHaveTextContent('None');
    expect(screen.getByTestId('checkout-total-amount')).toHaveTextContent('₱545.00');
  });

  it('the server\'s 422 on an SC/PWD field goes back to the cart and shows under that field in the sheet', async () => {
    fillExampleD();
    routeFetch([
      {
        method: 'POST',
        path: ORDERS,
        reply: () =>
          mockResponse(422, {
            message: 'The sc pwd.persons.0.id no field format is invalid.',
            errors: { 'sc_pwd.persons.0.id_no': ['The sc pwd.persons.0.id no field format is invalid.'] },
          }),
      },
    ]);
    await renderCheckout();
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await waitFor(() =>
      expect(useCartStore.getState().scPwdErrors).toEqual({ 'persons.0.id_no': 'The sc pwd.persons.0.id no field format is invalid.' }),
    );
    expect(screen.getByTestId('checkout-sc-pwd-error')).toHaveTextContent('The sc pwd.persons.0.id no field format is invalid.');
    await fireEvent.press(screen.getByTestId('checkout-sc-pwd-edit'));
    expect(await screen.findByTestId('sc-pwd-person-0-id-error')).toHaveTextContent('The sc pwd.persons.0.id no field format is invalid.');
  });

  it('offline: the sale is saved with sc_pwd in its OfflineOrder and local order, and the receipt prints the SC/PWD lines', async () => {
    setOnline(false);
    await secureStoreMock().setItemAsync('pos.device.registered', JSON.stringify({ id: 1, code: 'T01', apiOrigin: ORIGIN, branchId: 1 }));
    await storeMenu();
    fillExampleD({ ...SENIOR, vat_exempt: false });
    const { calls } = routeFetch([]);
    await renderCheckout();
    // No approval block offline either.
    expect(screen.queryByText('Needs a manager approval — connect to the internet.')).toBeNull();

    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));
    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    expect(orderCalls(calls)).toHaveLength(0);

    const [record] = await offlineRepository.listLocalOrders();
    expect(record.order.sc_pwd).toEqual({
      mode: 'items',
      persons: [{ type: 'senior_citizen', id_no: 'OSCA-12345' }],
      diners: null,
      vat_exempt: false,
      vat_relief_cents: 0,
      discount_cents: 5900,
    });
    expect(record.order.items.map((item) => [item.sc_pwd, item.sc_pwd_eligible_cents, item.sc_pwd_discount_cents, item.line_total_cents])).toEqual([
      [true, 25000, 5000, 20000],
      [true, 4500, 900, 3600],
      [false, 0, 0, 25000],
    ]);
    expect(record.order.total_cents).toBe(48600);
    const [entry] = await offlineRepository.nextBatch(50, '2999-01-01T00:00:00Z', false);
    expect(entry.payload).toMatchObject<Partial<OfflineOrder>>({
      client_total_cents: 48600,
      shift_ulid: TEST_SHIFT_ULID,
      sc_pwd: { mode: 'items', persons: [{ type: 'senior_citizen', id_no: 'OSCA-12345' }], diners: null, vat_exempt: false },
    });
    expect((entry.payload as OfflineOrder).items.map((item) => item.sc_pwd)).toEqual([true, true, false]);

    await settlePrinting();
    const receipt = decodeEscPos(fake.sentTo(9100)[0].bytes);
    expect(receipt).toContain('SC/PWD discount 20%');
    expect(receipt).not.toContain('VAT exempted');
    expect(receipt).toContain('Senior citizen  ID OSCA-12345');
    expect(receipt).toContain('Signature: ');
  });
});
