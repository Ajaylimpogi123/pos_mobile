/**
 * Table Number (Core Sale revision 2) through the screens: the optional Table
 * field in the cart (checked like the server, locked while a sale attempt is
 * unconfirmed, a 422 shown under it), `table_no` in the checkout body, "Table
 * 12" on the success screen, and in Orders (card and detail header).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import OrderRoute from '@/app/(app)/(pos)/orders/[ulid]';
import OrdersIndexRoute from '@/app/(app)/(pos)/orders/index';
import CheckoutRoute from '@/app/(app)/(pos)/sell/checkout';
import SellRoute from '@/app/(app)/(pos)/sell/index';
import { catalogueRepository } from '@/db/catalogueRepository';
import { TABLE_NO_INVALID } from '@/sale/table';
import { resetCart, useCartStore } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, page, renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { seedOpenShift } from '@/test-utils/shifts';
import { fillCartWithExampleB, makeOrder, makeOrderSummary } from '@/test-utils/sale';
import { SERVER_TIME, seedMenu } from '@/test-utils/sync';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

// Printing and the print config are covered elsewhere; keep these tests to the table number.
jest.mock('@/sync/printConfigSync', () => ({
  requestPrintConfigSync: jest.fn(async () => ({ outcome: 'offline' })),
}));

const FUTURE = '2099-09-25T01:30:00Z';
const ORDERS = '/api/v1/orders';

beforeEach(async () => {
  await freshTestDatabase();
  // Phase 6: sales need an open shift on the tablet.
  seedOpenShift();
  useSyncStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  resetCart();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  (router.back as jest.Mock).mockClear();
});

describe('the cart', () => {
  async function renderSellWithMenu() {
    await catalogueRepository.replaceCatalogue(seedMenu(), { cursor: 'c1', apiOrigin: 'http://192.168.1.50:8000', serverTime: SERVER_TIME });
    routeFetch([]);
    await renderWithQuery(<SellRoute />);
    await waitFor(() => expect(screen.queryByTestId('sell-loading')).toBeNull());
    await fireEvent.press(screen.getByTestId('product-tile-1-body'));
  }

  it('has an optional Table field next to the customer; an invalid value is shown under it and blocks Charge', async () => {
    await renderSellWithMenu();

    const field = screen.getByTestId('cart-table');
    expect(field.props.value).toBe('');
    await fireEvent.changeText(field, '#12');
    expect(screen.getByTestId('cart-table-error')).toHaveTextContent(TABLE_NO_INVALID);
    expect(screen.getByTestId('cart-checkout')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('cart-table'), ' Patio 2 ');
    expect(screen.queryByTestId('cart-table-error')).toBeNull();
    expect(screen.getByTestId('cart-checkout')).not.toBeDisabled();
    expect(useCartStore.getState().tableNo).toBe(' Patio 2 ');
  });

  it("shows the server's 422 under the field, and locks it while a sale attempt is unconfirmed", async () => {
    await renderSellWithMenu();
    await fireEvent.changeText(screen.getByTestId('cart-table'), '12');

    await act(async () =>
      useCartStore.getState().showServerErrors({ lines: {}, orderDiscount: null, customer: null, table: 'The table no field format is invalid.', cart: null }),
    );
    expect(screen.getByTestId('cart-table-error')).toHaveTextContent('The table no field format is invalid.');

    await act(async () => useCartStore.getState().setAwaitingConfirmation(true));
    expect(screen.getByTestId('cart-table').props.editable).toBe(false);
  });
});

describe('checkout', () => {
  it('sends the trimmed table_no, shows "Table A3" on the success screen, and the next sale starts without a table', async () => {
    fillCartWithExampleB();
    useCartStore.getState().setTableNo('  A3 ');
    const { calls } = routeFetch([{ method: 'POST', path: ORDERS, reply: () => mockResponse(201, { data: makeOrder({ table_no: 'A3' }) }) }]);
    await renderWithQuery(<CheckoutRoute />);
    await fireEvent.press(await screen.findByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    expect(await screen.findByTestId('sale-table')).toHaveTextContent('Table A3');
    const post = calls.find((call) => call.method === 'POST' && call.path === ORDERS);
    expect(post && (jsonBody(post) as { table_no: string | null }).table_no).toBe('A3');
    expect(useCartStore.getState().tableNo).toBe('');
  });

  it('sends null without a table, and shows no table on the success screen', async () => {
    fillCartWithExampleB();
    const { calls } = routeFetch([{ method: 'POST', path: ORDERS, reply: () => mockResponse(201, { data: makeOrder() }) }]);
    await renderWithQuery(<CheckoutRoute />);
    await fireEvent.press(await screen.findByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await screen.findByTestId('sale-complete');
    expect(screen.queryByTestId('sale-table')).toBeNull();
    const post = calls.find((call) => call.method === 'POST' && call.path === ORDERS);
    expect(post && (jsonBody(post) as { table_no: string | null }).table_no).toBeNull();
  });

  it('a 422 on table_no goes back to the cart with the message on the Table field', async () => {
    fillCartWithExampleB();
    useCartStore.getState().setTableNo('12');
    routeFetch([
      {
        method: 'POST',
        path: ORDERS,
        reply: () => mockResponse(422, { message: 'The table no field format is invalid.', errors: { table_no: ['The table no field format is invalid.'] } }),
      },
    ]);
    await renderWithQuery(<CheckoutRoute />);
    await fireEvent.press(await screen.findByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(useCartStore.getState().tableError).toBe('The table no field format is invalid.');
  });
});

describe('orders', () => {
  it('the card shows the table next to the queue number (only when set)', async () => {
    const withTable = makeOrderSummary({ table_no: '12' });
    const withoutTable = makeOrderSummary({ ulid: '01K62Y0000000000000000000A', invoice_no: 'INV-MAIN-00000041', queue_no: 16 });
    routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([withTable, withoutTable], null, ORDERS)) }]);
    await renderWithQuery(<OrdersIndexRoute />);

    const card = await screen.findByTestId(`order-card-${withTable.ulid}-table`);
    expect(card).toHaveTextContent('Table 12');
    expect(screen.queryByTestId(`order-card-${withoutTable.ulid}-table`)).toBeNull();
  });

  it('the detail header shows the table', async () => {
    const order = makeOrder({ table_no: 'Patio 2' });
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: order.ulid });
    routeFetch([{ method: 'GET', path: `${ORDERS}/${order.ulid}`, reply: () => mockResponse(200, { data: order }) }]);
    await renderWithQuery(<OrderRoute />);

    const chip = await screen.findByTestId('order-table');
    expect(within(chip).getByText('Table Patio 2')).toBeOnTheScreen();
  });
});
