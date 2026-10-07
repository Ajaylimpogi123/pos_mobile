/**
 * Sales with shifts (docs/api-contract.md → Shifts & Reporting → Order
 * changes and Device rules → Local storage): `shift_ulid` in the online body,
 * no sale without an open shift, the closed-shift `422` sending the cashier
 * to "Open a shift", every online sale stored on the tablet as `synced`, and
 * pruning to the current shift and the last 7 days.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import CheckoutRoute from '@/app/(app)/(pos)/sell/checkout';
import { offlineRepository } from '@/db/offlineRepository';
import { shiftRepository } from '@/db/shiftRepository';
import { resetCart, useCartStore } from '@/stores/cart';
import { useConnectivityStore } from '@/stores/connectivity';
import { useSessionStore } from '@/stores/session';
import { useShiftStore } from '@/stores/shift';
import { useSyncStore } from '@/stores/sync';
import { pruneLocalData, resetShiftActionsForTests } from '@/shifts/shiftActions';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { HOT_DOG, makeOrder } from '@/test-utils/sale';
import { seedOpenShift } from '@/test-utils/shifts';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/printActions', () => ({
  ...jest.requireActual<typeof import('@/printing/printActions')>('@/printing/printActions'),
  printSale: jest.fn(async () => undefined),
}));

const FUTURE = '2099-09-25T01:30:00Z';
const ORDERS = '/api/v1/orders';

function orderCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method === 'POST' && call.path === ORDERS);
}

async function renderCheckout() {
  const result = await renderWithQuery(<CheckoutRoute />);
  await screen.findByTestId('checkout-confirm');
  return result;
}

async function expectMessage(testID: string, message: string) {
  const element = await screen.findByTestId(testID);
  expect(within(element).getByText(message)).toBeOnTheScreen();
}

beforeEach(async () => {
  await freshTestDatabase();
  useShiftStore.getState().reset();
  resetShiftActionsForTests();
  useSyncStore.getState().reset();
  useConnectivityStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  resetCart();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  (router.back as jest.Mock).mockClear();
});

it('without an open shift, checkout says so and Confirm stays disabled (no request)', async () => {
  const { calls } = routeFetch([]);
  useCartStore.getState().addProduct(HOT_DOG);
  await renderCheckout();
  await expectMessage('checkout-no-shift', 'Open a shift on the Sell screen before charging.');
  await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
  expect(screen.getByTestId('checkout-confirm')).toBeDisabled();
  expect(orderCalls(calls)).toHaveLength(0);
});

it('sends shift_ulid, then stores the online sale on the tablet as synced (for the shift report)', async () => {
  const shift = seedOpenShift();
  const { calls } = routeFetch([
    { method: 'POST', path: ORDERS, reply: (call) => mockResponse(201, { data: makeOrder({ ulid: (jsonBody(call) as { ulid: string }).ulid, total_cents: 8000 }) }) },
  ]);
  useCartStore.getState().addProduct(HOT_DOG);
  await renderCheckout();
  await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
  await fireEvent.press(screen.getByTestId('checkout-confirm'));
  expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();

  const [call] = orderCalls(calls);
  const body = jsonBody(call) as { ulid: string; shift_ulid: string };
  expect(body.shift_ulid).toBe(shift.ulid);
  await waitFor(async () => {
    const stored = await offlineRepository.getLocalOrder(body.ulid);
    expect(stored).toMatchObject({ status: 'synced', orderNo: null, shiftUlid: shift.ulid, branchId: 1, cashierId: 3 });
  });
  // An online sale is not a pending offline sale: nothing is queued.
  expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 0 });
});

it('422 "This shift is closed. Open a new shift." closes the shift here and goes back to Sell, keeping the cart', async () => {
  const shift = seedOpenShift();
  routeFetch([
    {
      method: 'POST',
      path: ORDERS,
      reply: () =>
        mockResponse(422, {
          message: 'This shift is closed. Open a new shift.',
          errors: { shift_ulid: ['This shift is closed. Open a new shift.'] },
        }),
    },
  ]);
  useCartStore.getState().addProduct(HOT_DOG);
  await renderCheckout();
  await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
  await fireEvent.press(screen.getByTestId('checkout-confirm'));

  await waitFor(() => expect(router.back).toHaveBeenCalled());
  await waitFor(() => expect(useShiftStore.getState().gateNotice).toBe('This shift is closed. Open a new shift.'));
  expect(useShiftStore.getState().current).toBeNull();
  expect((await shiftRepository.getShift(shift.ulid))?.status).toBe('closed');
  // Nothing was sent to close it (the server already has it closed), and the sale is still in the cart.
  expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 0 });
  expect(useCartStore.getState().lines).toHaveLength(1);
});

describe('pruning: only the current shift and the last 7 days', () => {
  const NOW = Date.parse('2026-09-26T03:00:00Z');

  it('deletes synced sales older than 7 days except the current shift; never unsynced ones; old closed shifts go', async () => {
    const current = seedOpenShift({ ulid: '01K6S00000000000000000000C' });
    const old = { branchId: 1, now: '2026-09-10T00:00:00Z' };
    await offlineRepository.saveSyncedSale(makeOrder({ ulid: '01K6300000000000000000000A', shift_ulid: '01K6S00000000000000000000P' }), { ...old, shiftUlid: '01K6S00000000000000000000P' });
    await offlineRepository.saveSyncedSale(makeOrder({ ulid: '01K6300000000000000000000B', shift_ulid: current.ulid }), { ...old, shiftUlid: current.ulid });
    await offlineRepository.saveSyncedSale(makeOrder({ ulid: '01K6300000000000000000000D', shift_ulid: '01K6S00000000000000000000P' }), {
      branchId: 1,
      shiftUlid: '01K6S00000000000000000000P',
      now: '2026-09-25T00:00:00Z',
    });
    await offlineRepository.saveOfflineSale(
      { ulid: '01K6300000000000000000000E', deviceCode: 'T01', businessDate: '2026-09-10', branchId: 1, cashierId: 3, shiftUlid: '01K6S00000000000000000000P', now: '2026-09-10T00:00:00Z', stockDemand: [] },
      () => ({
        order: { ...makeOrder({ ulid: '01K6300000000000000000000E' }), invoice_no: null },
        payload: {
          ulid: '01K6300000000000000000000E',
          customer_id: null,
          notes: null,
          table_no: null,
          items: [],
          discount: null,
          payments: [],
          client_total_cents: 0,
          order_no: 'T01-20260910-0001',
          placed_at: '2026-09-10T00:00:00Z',
          cashier_id: 3,
          shift_ulid: '01K6S00000000000000000000P',
          sc_pwd: null,
        },
      }),
    );
    // A closed shift from two weeks ago, synced (no outbox row).
    await shiftRepository.openShift({ ulid: '01K6S00000000000000000000P', branchId: 2, openedAt: '2026-09-09T00:00:00Z', openedBy: { id: 3, name: 'C' }, openingFloatCents: 0 });
    await shiftRepository.closeShift({ shiftUlid: '01K6S00000000000000000000P', eventUlid: '01K6S00000000000000000000Q', closedAt: '2026-09-10T00:00:00Z', closedBy: { id: 3, name: 'C' }, countedCashCents: 0, closeNote: null });

    // While the old shift's events are still in the outbox, it is kept.
    await pruneLocalData(NOW, current.ulid);
    expect(await shiftRepository.getShift('01K6S00000000000000000000P')).not.toBeNull();
    await offlineRepository.completeShiftEvent('01K6S00000000000000000000P');
    await offlineRepository.completeShiftEvent('01K6S00000000000000000000Q');
    await pruneLocalData(NOW, current.ulid);

    const left = (await offlineRepository.listLocalOrders()).map((record) => record.ulid).sort();
    expect(left).toEqual(['01K6300000000000000000000B', '01K6300000000000000000000D', '01K6300000000000000000000E']);
    expect(await shiftRepository.getShift('01K6S00000000000000000000P')).toBeNull();
    expect(await shiftRepository.getShift(current.ulid)).not.toBeNull();
  });
});
