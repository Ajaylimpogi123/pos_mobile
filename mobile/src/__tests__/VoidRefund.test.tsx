/**
 * Voids & Refunds (docs/api-contract.md → Voids & Refunds (Phase 7) → Device
 * rules) through the real screens, the shared API client (fetch mocked), the
 * in-memory SQLite database and a fake printer transport:
 * - the order detail's gating (status, this tablet's shift, online, unsynced);
 * - the void dialog (approval, Retry with the same key, printing, give-back);
 * - the refund screen (steppers, BigInt amount, split, approval, Retry with
 *   the same ulid, a quantity 422 that refetches, a shift 422);
 * - the tablet's shift report after a void and a refund;
 * - the Orders list's status badges and Status filter.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import OrderRoute from '@/app/(app)/(pos)/orders/[ulid]/index';
import RefundRoute from '@/app/(app)/(pos)/orders/[ulid]/refund';
import OrdersIndexRoute from '@/app/(app)/(pos)/orders/index';
import { ROUTES } from '@/constants/routes';
import { offlineRepository } from '@/db/offlineRepository';
import { refundRepository } from '@/db/refundRepository';
import { resetPrintingForTests, whenPrintQueueIdle } from '@/printing/printActions';
import { getPrintTransport } from '@/printing/transport';
import { REFUND_UNCONFIRMED_MESSAGE, REVERSAL_OFFLINE_MESSAGE, VOID_UNCONFIRMED_MESSAGE } from '@/sale/reversals';
import type { Order, RefundCreateRequest } from '@/services/types';
import { useConnectivityStore } from '@/stores/connectivity';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { useShiftStore } from '@/stores/shift';
import { localShiftReport } from '@/shifts/shiftActions';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { printedLines } from '@/test-utils/escpos';
import { createFakeTransport, makePrintConfig, makeSettings, type FakeTransport } from '@/test-utils/printing';
import {
  makeOrder,
  makeOrderSummary,
  makePartlyRefundedOrder,
  makeRefund,
  makeVoidedOrder,
  PIN_USERS,
} from '@/test-utils/sale';
import { makeLocalShift, seedOpenShift, TEST_SHIFT_ULID } from '@/test-utils/shifts';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

const FUTURE = '2099-09-25T01:30:00Z';
const ULID = makeOrder().ulid;
const ORDER_PATH = `/api/v1/orders/${ULID}`;
const VOID_PATH = `${ORDER_PATH}/void`;
const REFUND_PATH = `${ORDER_PATH}/refunds`;
const useNetworkState = jest.requireMock('expo-network').useNetworkState as jest.Mock;
const getTransport = getPrintTransport as jest.Mock;
let fake: FakeTransport;

const pinUsersRoute: Route = {
  method: 'GET',
  path: '/api/v1/auth/pin-users',
  reply: () => mockResponse(200, page(PIN_USERS, null, '/api/v1/auth/pin-users')),
};

function orderRoute(order: () => Order): Route {
  return { method: 'GET', path: ORDER_PATH, reply: () => mockResponse(200, { data: order() }) };
}

function posts(calls: FetchCall[], path: string): FetchCall[] {
  return calls.filter((call) => call.method === 'POST' && call.path === path);
}

function keyOf(call: FetchCall): string {
  return (call.init.headers as Record<string, string>)['Idempotency-Key'];
}

/** Matches text that contains `text` (a chip or banner icon glyph is part of the text content). */
function contains(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

async function enterPin(prefix: string, pin: string) {
  for (const digit of pin) await fireEvent.press(screen.getByTestId(`${prefix}-key-${digit}`));
}

async function settle() {
  await act(async () => {
    await whenPrintQueueIdle();
  });
}

/** Stores the sale on the tablet as an online sale of the open shift (as checkout does). */
async function storeSale(order: Order = makeOrder()) {
  await offlineRepository.saveSyncedSale(order, { branchId: 1, shiftUlid: order.shift_ulid, now: '2026-09-25T04:12:10Z' });
}

beforeEach(async () => {
  await freshTestDatabase();
  seedOpenShift();
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  usePrintingStore.getState().setConfig(makePrintConfig());
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  useConnectivityStore.getState().reset();
  useNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: ULID });
  (router.navigate as jest.Mock).mockClear();
  fake = createFakeTransport();
  getTransport.mockReturnValue(fake.transport);
});

afterEach(async () => {
  await settle();
});

describe('order detail: where the actions are', () => {
  it('a completed sale of this tablet\'s open shift offers Void sale and Refund', async () => {
    routeFetch([orderRoute(() => makeOrder())]);
    await renderWithQuery(<OrderRoute />);
    expect(await screen.findByTestId('order-void-action')).toBeEnabled();
    expect(screen.getByTestId('order-refund-action')).toBeEnabled();
    expect(screen.getByTestId('order-status')).toHaveTextContent(contains('Completed'));
  });

  it('a sale of another shift offers Refund only', async () => {
    routeFetch([orderRoute(() => makeOrder({ shift_ulid: '01K6S0A1B2C3D4E5F6G7H8J9KN' }))]);
    await renderWithQuery(<OrderRoute />);
    expect(await screen.findByTestId('order-refund-action')).toBeEnabled();
    expect(screen.queryByTestId('order-void-action')).toBeNull();
  });

  it('offline: both disabled, with "Voids and refunds need a connection."', async () => {
    routeFetch([orderRoute(() => makeOrder())]);
    await renderWithQuery(<OrderRoute />);
    await screen.findByTestId('order-void-action');
    useNetworkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    await act(async () => {
      useConnectivityStore.getState().setServerReachable(false);
    });
    await waitFor(() => expect(screen.getByTestId('order-void-action')).toBeDisabled());
    expect(screen.getByTestId('order-refund-action')).toBeDisabled();
    expect(screen.getByTestId('order-reversal-message')).toHaveTextContent(contains(REVERSAL_OFFLINE_MESSAGE));
  });

  it('a voided sale shows its void block and no action', async () => {
    routeFetch([orderRoute(() => makeVoidedOrder())]);
    await renderWithQuery(<OrderRoute />);
    expect(await screen.findByTestId('order-void')).toBeOnTheScreen();
    expect(screen.getByTestId('order-status')).toHaveTextContent(contains('Voided'));
    expect(screen.getByTestId('order-void-reason')).toHaveTextContent(contains('Customer cancelled'));
    expect(screen.getByTestId('order-void-approver')).toHaveTextContent(contains('Marco Manager'));
    expect(screen.queryByTestId('order-reversals')).toBeNull();
  });

  it('a partly refunded sale shows its refunds and the per-line refunded quantity', async () => {
    routeFetch([orderRoute(() => makePartlyRefundedOrder())]);
    await renderWithQuery(<OrderRoute />);
    expect(await screen.findByTestId('order-refunds')).toBeOnTheScreen();
    expect(screen.getByTestId('order-status')).toHaveTextContent(contains('Partly refunded'));
    expect(screen.getByTestId('order-item-103-refunded')).toHaveTextContent(contains('Refunded 1 of 3 · −₱33.69'));
    expect(screen.getByTestId('order-refund-0-amount-amount')).toHaveTextContent(contains('₱33.69'));
    expect(screen.getByTestId('order-refund-0-reason')).toHaveTextContent(contains('Wrong drink'));
    expect(screen.queryByTestId('order-void-action')).toBeNull();
    expect(screen.getByTestId('order-refund-action')).toBeEnabled();
  });

  it('Reprint → Refund slip reprints that refund, marked *** REPRINT ***', async () => {
    routeFetch([orderRoute(() => makePartlyRefundedOrder())]);
    await renderWithQuery(<OrderRoute />);
    await fireEvent.press(await screen.findByTestId('order-reprint'));
    await fireEvent.press(screen.getByTestId('reprint-refund-slip-0'));
    await settle();
    await waitFor(() => expect(fake.sentTo(9100)).toHaveLength(1));
    const lines = printedLines(fake.sentTo(9100)[0].bytes);
    expect(lines).toContain('REFUND');
    expect(lines).toContain('*** REPRINT ***');
  });
});

describe('the void dialog', () => {
  it('asks a manager (can_approve_voids only), retries a lost answer with the same key, then prints and says what to give back', async () => {
    await storeSale();
    let attempt = 0;
    const { calls } = routeFetch([
      orderRoute(() => makeOrder()),
      pinUsersRoute,
      {
        method: 'POST',
        path: VOID_PATH,
        reply: () => {
          attempt += 1;
          if (attempt === 1) return Promise.reject(new TypeError('Network request failed'));
          return mockResponse(200, { data: makeVoidedOrder() });
        },
      },
    ]);
    await renderWithQuery(<OrderRoute />);
    await fireEvent.press(await screen.findByTestId('order-void-action'));
    const dialog = screen.getByTestId('void-dialog');

    // Only the people with sale.void (the manager and the owner).
    await waitFor(() => expect(within(dialog).getByTestId('approver-2')).toBeOnTheScreen());
    expect(within(dialog).queryByTestId('approver-3')).toBeNull();
    expect(screen.getByTestId('void-confirm')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('void-reason-0'));
    await fireEvent.press(within(dialog).getByTestId('approver-2'));
    await enterPin('void-approval-pin', '2468');
    await fireEvent.press(screen.getByTestId('void-confirm'));

    expect(await screen.findByTestId('void-banner')).toHaveTextContent(contains(VOID_UNCONFIRMED_MESSAGE));
    expect(screen.getByTestId('void-confirm')).toHaveTextContent(contains('Retry'));
    await fireEvent.press(screen.getByTestId('void-confirm'));

    expect(await screen.findByTestId('void-give-back-0')).toHaveTextContent(contains('Sale voided. Give back ₱157.00 cash'));
    expect(screen.getByTestId('void-give-back-1')).toHaveTextContent(contains('Send back ₱100.00 GCash'));

    const sent = posts(calls, VOID_PATH);
    expect(sent).toHaveLength(2);
    expect(keyOf(sent[0])).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]));
    expect(jsonBody(sent[0])).toEqual({ reason: 'Customer cancelled', authorization: { user_id: 2, pin: '2468' } });
    expect(jsonBody(sent[1])).toEqual(jsonBody(sent[0]));

    // The void slip on the receipt printer, a VOID ticket to each station the lines route to.
    await settle();
    await waitFor(() => expect(fake.sentTo(9100)).toHaveLength(1));
    expect(printedLines(fake.sentTo(9100)[0].bytes)).toContain('*** VOID ***');
    expect(printedLines(fake.sentTo(9101)[0].bytes).slice(0, 3)).toEqual(['KITCHEN', '*** VOID ***', '#17']);
    expect(printedLines(fake.sentTo(9102)[0].bytes)).toContain('Do not prepare');

    // The detail now shows the voided sale; the tablet's report counts it as a void.
    await fireEvent.press(screen.getByTestId('void-close'));
    expect(await screen.findByTestId('order-void')).toBeOnTheScreen();
    const report = await localShiftReport(makeLocalShift());
    expect(report).toMatchObject({ orders_count: 0, voids_count: 1, voids_cents: 25700, expected_cash_cents: 200000 });
  });

  it('a wrong PIN shows under the pad; an approver who can\'t approve goes back to the picker', async () => {
    const replies = [
      () => mockResponse(422, { message: 'Incorrect PIN.', errors: { 'authorization.pin': ['Incorrect PIN.'] } }),
      () => mockResponse(422, { message: 'x', errors: { 'authorization.user_id': ["This person can't approve voids."] } }),
    ];
    const { calls } = routeFetch([
      orderRoute(() => makeOrder()),
      pinUsersRoute,
      { method: 'POST', path: VOID_PATH, reply: () => (replies.shift() as () => Response)() },
    ]);
    await renderWithQuery(<OrderRoute />);
    await fireEvent.press(await screen.findByTestId('order-void-action'));
    await fireEvent.press(screen.getByTestId('void-reason-1'));
    await waitFor(() => expect(screen.getByTestId('approver-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('approver-1'));
    await enterPin('void-approval-pin', '1111');
    await fireEvent.press(screen.getByTestId('void-confirm'));
    expect(await screen.findByTestId('void-approval-pin-error')).toHaveTextContent(contains('Incorrect PIN.'));

    await enterPin('void-approval-pin', '2222');
    await fireEvent.press(screen.getByTestId('void-confirm'));
    const error = await screen.findByTestId('void-approval-error');
    expect(within(error).getByText("This person can't approve voids.")).toBeOnTheScreen();
    // A failed request doesn't use up the key.
    const sent = posts(calls, VOID_PATH);
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]));
  });

  it('with sale.void no PIN is asked; a 409 (the shift closed) is shown as it is; no tickets when print_kitchen_tickets is off', async () => {
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    usePrintingStore.getState().setConfig(makePrintConfig({ settings: makeSettings({ print_kitchen_tickets: false }) }));
    const replies = [
      () => mockResponse(409, { message: "This sale's shift is closed. Refund it instead." }),
      () => mockResponse(200, { data: makeVoidedOrder({ void_authorized_by: null }) }),
    ];
    const { calls } = routeFetch([orderRoute(() => makeOrder()), { method: 'POST', path: VOID_PATH, reply: () => (replies.shift() as () => Response)() }]);
    await renderWithQuery(<OrderRoute />);
    await fireEvent.press(await screen.findByTestId('order-void-action'));
    expect(screen.queryByTestId('void-approval')).toBeNull();
    await fireEvent.press(screen.getByTestId('void-reason-3'));
    await fireEvent.changeText(screen.getByTestId('void-reason-text'), 'Test sale');
    await fireEvent.press(screen.getByTestId('void-confirm'));
    const banner = await screen.findByTestId('void-banner');
    expect(within(banner).getByText("This sale's shift is closed. Refund it instead.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('void-confirm'));
    await screen.findByTestId('void-give-back-0');
    expect(jsonBody(posts(calls, VOID_PATH)[1])).toEqual({ reason: 'Test sale', authorization: null });
    await settle();
    await waitFor(() => expect(fake.sentTo(9100)).toHaveLength(1));
    expect(fake.sentTo(9101)).toHaveLength(0);
    expect(fake.sentTo(9102)).toHaveLength(0);
  });
});

describe('the refund screen', () => {
  /** A 201 built from what was sent: worked example C's refund with the sent ulid and payments. */
  function refundReply(call: FetchCall) {
    const body = jsonBody(call) as RefundCreateRequest;
    return mockResponse(201, {
      data: makePartlyRefundedOrder(
        makeRefund({
          ulid: body.ulid,
          shift_ulid: body.shift_ulid,
          reason: body.reason,
          authorized_by: body.authorization ? { id: 2, name: 'Marco Manager' } : null,
          payments: body.payments,
        }),
      ),
    });
  }

  it('worked example C with sale.refund: 1 Iced Tea, cash first, the contract body; then stores, prints and says what to give back', async () => {
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    await storeSale();
    const { calls } = routeFetch([orderRoute(() => makeOrder()), { method: 'POST', path: REFUND_PATH, reply: refundReply }]);
    await renderWithQuery(<RefundRoute />);
    await screen.findByTestId('refund-lines');
    expect(screen.queryByTestId('refund-approval')).toBeNull();
    expect(screen.getByTestId('refund-submit')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('refund-qty-103-plus'));
    expect(screen.getByTestId('refund-amount-amount')).toHaveTextContent(contains('₱33.69'));
    // SHOW_VAT_BREAKDOWN is off (constants/features.ts): no VAT split.
    expect(screen.queryByTestId('refund-vatable')).toBeNull();
    expect(screen.queryByTestId('refund-vat')).toBeNull();
    expect(screen.queryByTestId('refund-vat-exempt')).toBeNull();
    expect(screen.getByTestId('refund-cash').props.value).toBe('33.69');
    expect(screen.getByTestId('refund-gcash').props.value).toBe('');

    await fireEvent.changeText(screen.getByTestId('refund-reason'), 'Wrong drink');
    await fireEvent.press(screen.getByTestId('refund-submit'));

    expect(await screen.findByTestId('refund-give-back-0')).toHaveTextContent(contains('Refund done. Give back ₱33.69 cash'));
    const [sent] = posts(calls, REFUND_PATH);
    const body = jsonBody(sent) as RefundCreateRequest;
    expect(keyOf(sent)).toBe(body.ulid);
    expect(body).toEqual({
      ulid: body.ulid,
      shift_ulid: TEST_SHIFT_ULID,
      reason: 'Wrong drink',
      items: [{ order_item_id: 103, qty: 1 }],
      payments: [{ method: 'cash', amount_cents: 3369, reference_no: null }],
      client_refund_cents: 3369,
      authorization: null,
    });

    await settle();
    await waitFor(() => expect(fake.sentTo(9100)).toHaveLength(1));
    expect(printedLines(fake.sentTo(9100)[0].bytes)).toContain('REFUND');

    const stored = await refundRepository.listForShift(TEST_SHIFT_ULID);
    expect(stored.map((record) => [record.ulid, record.orderUlid])).toEqual([[body.ulid, ULID]]);
    const report = await localShiftReport(makeLocalShift());
    expect(report).toMatchObject({
      orders_count: 1,
      refunds_count: 1,
      refunds_cents: 3369,
      net_after_refunds_cents: 25700 - 3369,
      // 200000 float + 15700 cash − 3369 cash refund.
      expected_cash_cents: 212331,
    });
  });

  it('Refund everything, split cash then GCash (the reference is required); a cashier needs a manager\'s PIN (can_approve_refunds)', async () => {
    const { calls } = routeFetch([orderRoute(() => makeOrder()), pinUsersRoute, { method: 'POST', path: REFUND_PATH, reply: refundReply }]);
    await renderWithQuery(<RefundRoute />);
    await screen.findByTestId('refund-lines');
    await fireEvent.press(screen.getByTestId('refund-everything'));
    expect(screen.getByTestId('refund-amount-amount')).toHaveTextContent(contains('₱257.00'));
    expect(screen.getByTestId('refund-cash').props.value).toBe('157.00');
    expect(screen.getByTestId('refund-gcash').props.value).toBe('100.00');

    const approval = screen.getByTestId('refund-approval');
    await waitFor(() => expect(within(approval).getByTestId('approver-2')).toBeOnTheScreen());
    expect(within(approval).queryByTestId('approver-3')).toBeNull();
    await fireEvent.press(within(approval).getByTestId('approver-2'));
    await enterPin('refund-approval-pin', '2468');
    await fireEvent.changeText(screen.getByTestId('refund-reason'), 'Customer complaint');
    await fireEvent.press(screen.getByTestId('refund-submit'));
    expect(await screen.findByTestId('refund-reference-error')).toHaveTextContent(contains('Enter the reference of the GCash transfer back.'));
    expect(posts(calls, REFUND_PATH)).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('refund-reference'), 'GB-77');
    await fireEvent.press(screen.getByTestId('refund-submit'));
    expect(await screen.findByTestId('refund-give-back-1')).toHaveTextContent(contains('Send back ₱100.00 GCash'));
    const body = jsonBody(posts(calls, REFUND_PATH)[0]) as RefundCreateRequest;
    expect(body.payments).toEqual([
      { method: 'cash', amount_cents: 15700, reference_no: null },
      { method: 'gcash', amount_cents: 10000, reference_no: 'GB-77' },
    ]);
    expect(body.client_refund_cents).toBe(25700);
    expect(body.authorization).toEqual({ user_id: 2, pin: '2468' });
  });

  it('a lost answer locks the form and Retry sends the same ulid and body', async () => {
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    let attempt = 0;
    const { calls } = routeFetch([
      orderRoute(() => makeOrder()),
      {
        method: 'POST',
        path: REFUND_PATH,
        reply: (call) => {
          attempt += 1;
          return attempt === 1 ? Promise.reject(new TypeError('Network request failed')) : refundReply(call);
        },
      },
    ]);
    await renderWithQuery(<RefundRoute />);
    await fireEvent.press(await screen.findByTestId('refund-qty-103-plus'));
    await fireEvent.changeText(screen.getByTestId('refund-reason'), 'Wrong drink');
    await fireEvent.press(screen.getByTestId('refund-submit'));
    expect(await screen.findByTestId('refund-banner')).toHaveTextContent(contains(REFUND_UNCONFIRMED_MESSAGE));
    expect(screen.getByTestId('refund-qty-103-plus')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('refund-submit'));
    await screen.findByTestId('refund-done');
    const [first, second] = posts(calls, REFUND_PATH);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(jsonBody(second)).toEqual(jsonBody(first));
  });

  it('a quantity 422 refetches the order and re-prices; the retry keeps the same ulid', async () => {
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    let current: Order = makeOrder();
    let attempt = 0;
    const { calls } = routeFetch([
      orderRoute(() => current),
      {
        method: 'POST',
        path: REFUND_PATH,
        reply: (call) => {
          attempt += 1;
          if (attempt === 1) {
            // Another tablet refunded 2 Iced Teas meanwhile.
            current = { ...makeOrder(), status: 'partially_refunded', items: makeOrder().items.map((item) => (item.id === 103 ? { ...item, refunded_qty: 2, refunded_cents: 6738 } : item)) };
            return mockResponse(422, { message: 'Only 1 left to refund.', errors: { 'items.0.qty': ['Only 1 left to refund.'] } });
          }
          return refundReply(call);
        },
      },
    ]);
    await renderWithQuery(<RefundRoute />);
    await fireEvent.press(await screen.findByTestId('refund-qty-103-plus'));
    await fireEvent.press(screen.getByTestId('refund-qty-103-plus'));
    expect(screen.getByTestId('refund-amount-amount')).toHaveTextContent(contains('₱67.38'));
    await fireEvent.changeText(screen.getByTestId('refund-reason'), 'Wrong drink');
    await fireEvent.press(screen.getByTestId('refund-submit'));

    expect(await screen.findByTestId('refund-line-103-error')).toHaveTextContent(contains('Only 1 left to refund.'));
    // Re-priced from the fetched order: only 1 is left, and it is the last third of the line.
    await waitFor(() => expect(screen.getByTestId('refund-qty-103-value')).toHaveTextContent(contains('1')));
    expect(screen.getByTestId('refund-amount-amount')).toHaveTextContent(contains('₱33.69'));
    expect(calls.filter((call) => call.method === 'GET' && call.path === ORDER_PATH).length).toBeGreaterThanOrEqual(2);

    await fireEvent.press(screen.getByTestId('refund-submit'));
    await screen.findByTestId('refund-done');
    const [first, second] = posts(calls, REFUND_PATH);
    expect(keyOf(second)).toBe(keyOf(first));
    expect((jsonBody(second) as RefundCreateRequest).client_refund_cents).toBe(3369);
  });

  it('a shift 422 closes the shift here and goes back to Sell\'s Open a shift', async () => {
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    routeFetch([
      orderRoute(() => makeOrder()),
      {
        method: 'POST',
        path: REFUND_PATH,
        reply: () => mockResponse(422, { message: 'x', errors: { shift_ulid: ['This shift is closed. Open a new shift.'] } }),
      },
    ]);
    await renderWithQuery(<RefundRoute />);
    await fireEvent.press(await screen.findByTestId('refund-qty-103-plus'));
    await fireEvent.changeText(screen.getByTestId('refund-reason'), 'Wrong drink');
    await fireEvent.press(screen.getByTestId('refund-submit'));
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith(ROUTES.sell));
    expect(useShiftStore.getState().current).toBeNull();
    expect(useShiftStore.getState().gateNotice).toBe('This shift is closed. Open a new shift.');
  });

  it('offline, or with no open shift on this tablet, the refund can\'t be sent', async () => {
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    routeFetch([orderRoute(() => makeOrder())]);
    await renderWithQuery(<RefundRoute />);
    await fireEvent.press(await screen.findByTestId('refund-qty-103-plus'));
    await fireEvent.changeText(screen.getByTestId('refund-reason'), 'Wrong drink');
    expect(screen.getByTestId('refund-submit')).toBeEnabled();
    useNetworkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    await act(async () => {
      useConnectivityStore.getState().setServerReachable(false);
    });
    await waitFor(() => expect(screen.getByTestId('refund-submit')).toBeDisabled());
    expect(screen.getByTestId('refund-blocker')).toHaveTextContent(contains(REVERSAL_OFFLINE_MESSAGE));
  });
});

describe('Orders list: status', () => {
  const NOW = Date.parse('2026-09-25T02:00:00Z');

  it('shows Voided / Partly refunded badges, and the Status filter sends `status`', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const voided = makeOrderSummary({ status: 'voided' });
    const partly = makeOrderSummary({ ulid: '01K62Y0000000000000000000A', status: 'partially_refunded', refunded_cents: 3369 });
    const { calls } = routeFetch([{ method: 'GET', path: '/api/v1/orders', reply: () => mockResponse(200, page([voided, partly], null, '/api/v1/orders')) }]);
    await renderWithQuery(<OrdersIndexRoute />);
    expect(await screen.findByTestId(`order-card-${voided.ulid}-status`)).toHaveTextContent(contains('Voided'));
    expect(screen.getByTestId(`order-card-${partly.ulid}-status`)).toHaveTextContent(contains('Partly refunded · ₱33.69'));

    await fireEvent.press(screen.getByTestId('orders-status'));
    await fireEvent.press(screen.getByTestId('orders-status-voided'));
    await waitFor(() => expect(calls[calls.length - 1].query.get('status')).toBe('voided'));
    expect(screen.getByTestId('orders-status')).toHaveTextContent(contains('Status · Voided'));
    jest.restoreAllMocks();
  });
});
