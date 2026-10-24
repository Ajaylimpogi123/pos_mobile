/**
 * Orders (contract → Core Sale → GET /orders, GET /orders/{ulid}, App →
 * Orders module): today's business date by default, a date selector,
 * invoice search, infinite scroll, and the receipt-style detail.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import OrderRoute from '@/app/(app)/(pos)/orders/[ulid]';
import OrdersIndexRoute from '@/app/(app)/(pos)/orders/index';
import { visibleModuleGroups } from '@/constants/modules';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { managerUser, page, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { mockVatBreakdown } from '@/test-utils/features';
import { makeOrder, makeOrderSummary } from '@/test-utils/sale';
import { viewerUser } from '@/test-utils/staff';

const FUTURE = '2099-09-25T01:30:00Z';
/** 10:00 on Fri 25 Sep 2026 in Manila: business date 2026-09-25 (day start 04:00). */
const NOW = Date.parse('2026-09-25T02:00:00Z');
const ORDERS = '/api/v1/orders';

const first = makeOrderSummary();
const second = makeOrderSummary({
  ulid: '01K62Y0000000000000000000A',
  invoice_no: 'INV-MAIN-00000041',
  queue_no: 16,
  placed_at: '2026-09-25T03:40:00Z',
  customer: null,
  items_count: 1,
  total_cents: 5000,
  payment_methods: ['cash'],
});
const older = makeOrderSummary({ ulid: '01K62X0000000000000000000B', invoice_no: 'INV-MAIN-00000040', queue_no: 15 });

function listCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method === 'GET' && call.path === ORDERS);
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  (router.push as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the Orders module', () => {
  it('is ready for `sale.create` or `report.view`, and hidden without both', () => {
    const orders = (user: typeof cashierUser) =>
      visibleModuleGroups(user)
        .flatMap((group) => group.modules)
        .find((module) => module.key === 'orders');

    expect(orders(cashierUser)).toMatchObject({ status: 'ready', route: '/orders' });
    expect(orders({ ...viewerUser, permissions: ['report.view'] })).toMatchObject({ status: 'ready' });
    expect(orders(viewerUser)).toBeUndefined();
  });
});

describe('Orders list', () => {
  it("defaults to today's business date and shows each order; a card opens its receipt", async () => {
    const { calls } = routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([first, second], null, ORDERS)) }]);

    await renderWithQuery(<OrdersIndexRoute />);
    const card = await screen.findByTestId(`order-card-${first.ulid}`);

    const [call] = listCalls(calls);
    expect(call.query.get('business_date')).toBe('2026-09-25');
    expect(call.query.get('per_page')).toBe('25');
    expect(call.query.has('search')).toBe(false);
    expect(screen.getByTestId('orders-date')).toHaveTextContent('Today · Fri, 25 Sep 2026');
    expect(screen.getByTestId('orders-next-day')).toBeDisabled();
    expect(screen.getByTestId('orders-band-subtitle')).toHaveTextContent(/^Your sales · /);

    expect(card).toHaveTextContent(/#17/);
    expect(card).toHaveTextContent(/INV-MAIN-00000042/);
    expect(card).toHaveTextContent(/Carla Cashier/);
    expect(screen.getByTestId(`order-card-${first.ulid}-total`)).toHaveTextContent('₱257.00');
    expect(screen.getByTestId(`order-card-${first.ulid}-customer`)).toHaveTextContent(/Maria Santos/);
    expect(card).toHaveTextContent(/6 items/);
    expect(screen.getByTestId(`order-card-${first.ulid}-gcash`)).toHaveTextContent(/GCash/);
    expect(screen.getByTestId(`order-card-${second.ulid}`)).toHaveTextContent(/1 item/);

    await fireEvent.press(screen.getByTestId(`order-card-${first.ulid}-open`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/orders/[ulid]', params: { ulid: first.ulid } });
  });

  it('each row has a ⋯ menu (View, Reprint, Refund, Void order) and the list ends with "Showing n"', async () => {
    routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([first, second], null, ORDERS)) }]);
    await renderWithQuery(<OrdersIndexRoute />);
    await screen.findByTestId(`order-card-${first.ulid}`);

    expect(screen.getByTestId('orders-grid-more-count')).toHaveTextContent('Showing 2');
    expect(screen.queryByTestId('orders-grid-more-button')).toBeNull();

    await fireEvent.press(screen.getByTestId(`order-card-${first.ulid}-actions`));
    expect(screen.getByTestId('order-actions-view')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('order-actions-reprint'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/orders/[ulid]', params: { ulid: first.ulid, action: 'reprint' } });
  });

  it('steps back a day (never past today), returns to Today, and shows all dates', async () => {
    const { calls } = routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([first], null, ORDERS)) }]);
    await renderWithQuery(<OrdersIndexRoute />);
    await screen.findByTestId(`order-card-${first.ulid}`);

    await fireEvent.press(screen.getByTestId('orders-prev-day'));
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.get('business_date')).toBe('2026-09-24'));
    expect(screen.getByTestId('orders-date')).toHaveTextContent('Thu, 24 Sep 2026');
    expect(screen.getByTestId('orders-next-day')).not.toBeDisabled();

    await fireEvent.press(screen.getByTestId('orders-next-day'));
    expect(screen.getByTestId('orders-date')).toHaveTextContent('Today · Fri, 25 Sep 2026');
    expect(screen.getByTestId('orders-next-day')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('orders-all-dates'));
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.has('business_date')).toBe(false));
    expect(screen.getByTestId('orders-date')).toHaveTextContent('All dates');
    expect(await screen.findByTestId(`order-card-${first.ulid}`)).toHaveTextContent(/Fri, 25 Sep 2026/);

    await fireEvent.press(screen.getByTestId('orders-today'));
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.get('business_date')).toBe('2026-09-25'));
  });

  it('searches invoice numbers (debounced) and loads the next page on scroll', async () => {
    const { calls } = routeFetch([
      {
        method: 'GET',
        path: ORDERS,
        reply: (call) =>
          mockResponse(200, call.query.get('cursor') === 'CUR2' ? page([older], null, ORDERS) : page([first, second], 'CUR2', ORDERS)),
      },
    ]);
    await renderWithQuery(<OrdersIndexRoute />);
    await screen.findByTestId(`order-card-${first.ulid}`);

    await act(async () => {
      fireEvent(screen.getByTestId('orders-grid'), 'onEndReached');
    });
    expect(await screen.findByTestId(`order-card-${older.ulid}`)).toBeOnTheScreen();
    expect(listCalls(calls).map((call) => call.query.get('cursor'))).toEqual([null, 'CUR2']);

    await fireEvent.changeText(screen.getByTestId('order-search'), '00000042');
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.get('search')).toBe('00000042'));
    expect(listCalls(calls).at(-1)?.query.get('business_date')).toBe('2026-09-25');
    expect(screen.getByTestId('order-search').props.maxLength).toBe(30);
  });

  it('says "No sales yet today" for an empty day, and shows errors with Retry', async () => {
    let fail = true;
    routeFetch([
      {
        method: 'GET',
        path: ORDERS,
        reply: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, page([], null, ORDERS))),
      },
    ]);
    await renderWithQuery(<OrdersIndexRoute />);

    expect(await screen.findByTestId('orders-grid-error')).toHaveTextContent(/Server Error\./);
    fail = false;
    await fireEvent.press(screen.getByTestId('orders-grid-error-retry'));
    expect(await screen.findByTestId('orders-grid-empty')).toHaveTextContent(/No sales yet today/);
  });

  it('tablets show a table (column headers, status chips, row opens the receipt); phones show cards', async () => {
    routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([first, second], null, ORDERS)) }]);
    await renderWithQuery(<OrdersIndexRoute />);
    await screen.findByTestId(`order-card-${first.ulid}`);

    expect(screen.getByTestId('orders-grid-header')).toHaveTextContent('OrderTimeTableCustomerPaymentTotalStatus');
    expect(screen.getByTestId(`order-card-${first.ulid}-status`)).toHaveTextContent(/Completed/);
    await fireEvent.press(screen.getByTestId(`order-card-${second.ulid}-open`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/orders/[ulid]', params: { ulid: second.ulid } });

    await act(async () => setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height));
    expect(screen.queryByTestId('orders-grid-header')).toBeNull();
    expect(screen.getByTestId(`order-card-${first.ulid}-total`)).toHaveTextContent('₱257.00');
    expect(screen.getByTestId(`order-card-${first.ulid}`)).toHaveTextContent(/Carla Cashier/);
    resetWindowSize();
  });

  it('tells a manager they see every sale of the branch', async () => {
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([], null, ORDERS)) }]);
    await renderWithQuery(<OrdersIndexRoute />);

    expect(await screen.findByTestId('orders-band-subtitle')).toHaveTextContent(/^All sales in this branch · /);
  });
});

describe('Order detail (receipt)', () => {
  it('GET /api/v1/orders/{ulid}: numbers, people, lines, totals, VAT and payments', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: first.ulid });
    const { calls } = routeFetch([
      {
        method: 'GET',
        path: `${ORDERS}/${first.ulid}`,
        reply: () => mockResponse(200, { data: makeOrder({ authorized_by: { id: 1, name: 'Olga Owner' } }) }),
      },
    ]);

    await renderWithQuery(<OrderRoute />);
    const receipt = await screen.findByTestId('order-receipt');

    expect(calls[0].path).toBe(`${ORDERS}/${first.ulid}`);
    expect(screen.getByTestId('order-invoice')).toHaveTextContent('INV-MAIN-00000042');
    expect(screen.getByTestId('order-queue')).toHaveTextContent('#17');
    expect(screen.getByTestId('order-status')).toHaveTextContent(/Completed$/);
    expect(screen.getByTestId('order-cashier')).toHaveTextContent('Carla Cashier');
    expect(screen.getByTestId('order-approver')).toHaveTextContent('Olga Owner');
    expect(screen.getByTestId('order-customer')).toHaveTextContent('Maria Santos');
    expect(within(receipt).getByTestId('order-item-101')).toHaveTextContent(/1 × Hot Dog/);
    expect(screen.getByTestId('order-item-101-discount')).toHaveTextContent('Promo · 10% · −₱8.00');
    expect(screen.getByTestId('order-item-101-total')).toHaveTextContent('₱69.30');
    // SHOW_VAT_BREAKDOWN is off (constants/features.ts): no VAT-exempt tag and no VAT rows.
    expect(screen.getByTestId('order-item-102')).not.toHaveTextContent(/VAT/);

    expect(screen.getByTestId('order-subtotal-amount')).toHaveTextContent('₱275.00');
    expect(screen.getByTestId('order-line-discounts-amount')).toHaveTextContent('−₱8.00');
    expect(screen.getByTestId('order-order-discount-amount')).toHaveTextContent('−₱10.00');
    expect(screen.getByTestId('order-total-amount')).toHaveTextContent('₱257.00');
    expect(screen.queryByTestId('order-vatable')).toBeNull();
    expect(screen.queryByTestId('order-vat')).toBeNull();
    expect(screen.queryByTestId('order-vat-exempt')).toBeNull();
    expect(screen.getByTestId('order-payment-0')).toHaveTextContent(/GCash.*Ref 1012345678901.*₱100\.00/);
    expect(screen.getByTestId('order-payment-1')).toHaveTextContent(/Cash.*Tendered ₱200\.00 · change ₱43\.00.*₱157\.00/);
    expect(screen.getByTestId('order-tendered-amount')).toHaveTextContent('₱300.00');
    expect(screen.getByTestId('order-change-amount')).toHaveTextContent('₱43.00');
    expect(screen.queryByTestId('order-mismatch')).toBeNull();
  });

  it('with SHOW_VAT_BREAKDOWN on: the VAT-exempt tag and the VAT rows', async () => {
    const flag = mockVatBreakdown(true);
    try {
      (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: first.ulid });
      routeFetch([{ method: 'GET', path: `${ORDERS}/${first.ulid}`, reply: () => mockResponse(200, { data: makeOrder() }) }]);
      await renderWithQuery(<OrderRoute />);
      await screen.findByTestId('order-receipt');

      expect(screen.getByTestId('order-item-102')).toHaveTextContent(/VAT-exempt/);
      expect(screen.getByTestId('order-total-amount')).toHaveTextContent('₱257.00');
      expect(screen.getByTestId('order-vatable-amount')).toHaveTextContent('₱152.12');
      expect(screen.getByTestId('order-vat-amount')).toHaveTextContent('₱18.25');
      expect(screen.getByTestId('order-vat-exempt-amount')).toHaveTextContent('₱86.63');
    } finally {
      flag.mockRestore();
    }
  });

  it('shows "Not found" for an order the user can\'t see (404), and for a malformed id without asking', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: first.ulid });
    routeFetch([{ method: 'GET', path: `${ORDERS}/${first.ulid}`, reply: () => mockResponse(404, { message: 'Resource not found.' }) }]);
    const view = await renderWithQuery(<OrderRoute />);
    expect(await screen.findByTestId('record-error')).toHaveTextContent(/Not found/);
    await view.unmount();

    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: 'not-a-ulid' });
    const { calls } = routeFetch([]);
    await renderWithQuery(<OrderRoute />);
    expect(await screen.findByTestId('record-error')).toHaveTextContent(/Not found/);
    expect(calls).toHaveLength(0);
  });
});
