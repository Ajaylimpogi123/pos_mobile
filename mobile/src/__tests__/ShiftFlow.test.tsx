/**
 * The shift flow on the Sell screen (docs/api-contract.md → Shifts &
 * Reporting → Device rules): the gate blocks sales without a shift; opening,
 * cash in / out and closing work offline (SQLite + outbox) and, online, the
 * outbox sends them at once; the X-read and the Z-read print on the receipt
 * printer; closing goes back to "Open a shift".
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import SellRoute from '@/app/(app)/(pos)/sell/index';
import { catalogueRepository } from '@/db/catalogueRepository';
import { offlineRepository } from '@/db/offlineRepository';
import { shiftRepository } from '@/db/shiftRepository';
import { resetPrintingForTests, whenPrintQueueIdle } from '@/printing/printActions';
import { getPrintTransport } from '@/printing/transport';
import { resetCart, useCartStore } from '@/stores/cart';
import { useConnectivityStore } from '@/stores/connectivity';
import { useOfflineStore } from '@/stores/offline';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { useShiftStore } from '@/stores/shift';
import { useSyncStore } from '@/stores/sync';
import { useToastStore } from '@/stores/toast';
import { resetShiftActionsForTests } from '@/shifts/shiftActions';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { decodeEscPos } from '@/test-utils/escpos';
import { createFakeTransport, makePrintConfig, type FakeTransport } from '@/test-utils/printing';
import { makeOrder } from '@/test-utils/sale';
import { makeShift, seedOpenShift } from '@/test-utils/shifts';
import { viewerUser } from '@/test-utils/staff';
import { SERVER_TIME, seedMenu } from '@/test-utils/sync';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

const FUTURE = '2099-09-25T01:30:00Z';
const getTransport = getPrintTransport as jest.Mock;
let fake: FakeTransport;

function setOnline(connected: boolean) {
  const network = jest.requireMock('expo-network') as { useNetworkState: jest.Mock; getNetworkStateAsync: jest.Mock };
  const state = { isConnected: connected, isInternetReachable: connected, type: connected ? 'WIFI' : 'NONE' };
  network.useNetworkState.mockReturnValue(state);
  network.getNetworkStateAsync.mockResolvedValue(state);
}

async function storeMenu() {
  await catalogueRepository.replaceCatalogue(seedMenu(), {
    cursor: 'c1',
    apiOrigin: 'http://192.168.1.50:8000',
    serverTime: SERVER_TIME,
  });
}

/** Lets the outbox worker and the print queue finish inside act(). */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await whenPrintQueueIdle();
  });
}

async function renderSell() {
  const result = await renderWithQuery(<SellRoute />);
  await waitFor(() => expect(screen.queryByTestId('shift-gate-loading')).toBeNull());
  return result;
}

function shiftCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.path.startsWith('/api/v1/shifts'));
}

function shiftRoutes() {
  return routeFetch([
    { method: 'POST', path: '/api/v1/shifts', reply: () => mockResponse(201, { data: makeShift({ status: 'open' }) }) },
    {
      method: 'POST',
      path: /^\/api\/v1\/shifts\/[0-9A-Z]{26}\/cash-movements$/,
      reply: (call) => mockResponse(201, { data: { ...(jsonBody(call) as object), user: { id: 3, name: 'Carla Cashier' } } }),
    },
    { method: 'POST', path: /^\/api\/v1\/shifts\/[0-9A-Z]{26}\/close$/, reply: () => mockResponse(200, { data: makeShift() }) },
  ]);
}

async function openShiftFromGate(amount = '2,000') {
  await fireEvent.changeText(screen.getByTestId('open-shift-amount'), amount);
  await fireEvent.press(screen.getByTestId('open-shift-submit'));
  expect(await screen.findByTestId('shift-pill')).toBeOnTheScreen();
}

async function openMenu() {
  await fireEvent.press(screen.getByTestId('shift-pill'));
  expect(await screen.findByTestId('shift-menu')).toBeOnTheScreen();
}

beforeEach(async () => {
  await freshTestDatabase();
  await storeMenu();
  useShiftStore.getState().reset();
  resetShiftActionsForTests();
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  usePrintingStore.getState().setConfig(makePrintConfig());
  useSyncStore.getState().reset();
  useOfflineStore.getState().reset();
  useConnectivityStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  resetCart();
  setOnline(true);
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  fake = createFakeTransport();
  getTransport.mockReturnValue(fake.transport);
});

afterEach(async () => {
  await settle();
});

describe('the shift gate', () => {
  it('without a shift, Sell shows "Open a shift" instead of the menu and the cart: no sale can start', async () => {
    shiftRoutes();
    await renderSell();

    expect(screen.getByTestId('open-shift-card')).toBeOnTheScreen();
    expect(screen.queryByTestId('cart-panel-side')).toBeNull();
    expect(screen.queryByTestId('cart-bar')).toBeNull();
    expect(screen.queryByTestId('product-tile-1-body')).toBeNull();
    expect(screen.queryByTestId('shift-pill')).toBeNull();
  });

  it('a user without sale.create keeps the read-only menu (no gate)', async () => {
    useSessionStore.getState().setSignedIn(viewerUser, FUTURE);
    shiftRoutes();
    await renderSell();
    expect(await screen.findByTestId('product-tile-1-body')).toBeOnTheScreen();
    expect(screen.queryByTestId('open-shift-card')).toBeNull();
  });

  it('someone who can sell but not open shifts is told to ask for one', async () => {
    useSessionStore.getState().setSignedIn({ ...cashierUser, permissions: ['sale.create'] }, FUTURE);
    shiftRoutes();
    await renderSell();
    expect(screen.getByTestId('open-shift-no-permission')).toBeOnTheScreen();
    expect(screen.queryByTestId('open-shift-submit')).toBeNull();
  });

  it('checks the starting cash before saving anything', async () => {
    shiftRoutes();
    await renderSell();
    await fireEvent.press(screen.getByTestId('open-shift-submit'));
    expect(screen.getByTestId('open-shift-amount-error')).toHaveTextContent('Enter the starting cash (0 if the drawer is empty).');
    await fireEvent.changeText(screen.getByTestId('open-shift-amount'), '1000000.01');
    await fireEvent.press(screen.getByTestId('open-shift-submit'));
    expect(screen.getByTestId('open-shift-amount-error')).toHaveTextContent("The starting cash can't be more than ₱1,000,000.00.");
    expect(await shiftRepository.currentShift(1)).toBeNull();
  });
});

describe('opening a shift', () => {
  it('offline: saved on the tablet with its outbox row, the menu and the cart appear, nothing is sent', async () => {
    setOnline(false);
    const { calls } = shiftRoutes();
    await renderSell();
    await openShiftFromGate('2,000');
    await settle();

    expect(screen.getByTestId('shift-pill').props.accessibilityLabel).toMatch(/^Shift since \d{1,2}:\d{2} (AM|PM)$/);
    expect(screen.getByTestId('cart-panel-side')).toBeOnTheScreen();
    const shift = await shiftRepository.currentShift(1);
    expect(shift).toMatchObject({ status: 'open', openingFloatCents: 200000, openedBy: { id: 3, name: 'Carla Cashier' } });
    expect(await offlineRepository.countOutbox()).toEqual({ pending: 1, needsAttention: 0 });
    expect(shiftCalls(calls)).toHaveLength(0);
  });

  it('online: the outbox sends POST /shifts at once', async () => {
    const { calls } = shiftRoutes();
    await renderSell();
    await openShiftFromGate('500');
    await waitFor(() => expect(shiftCalls(calls)).toHaveLength(1));
    await settle();

    const shift = await shiftRepository.currentShift(1);
    expect(jsonBody(shiftCalls(calls)[0])).toEqual({
      ulid: shift?.ulid,
      opened_at: shift?.openedAt,
      opened_by: 3,
      opening_float_cents: 50000,
    });
    await waitFor(async () => expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 0 }));
  });
});

describe('the shift menu', () => {
  it('cash in and cash out (amount + reason), offline; each is one outbox row', async () => {
    setOnline(false);
    seedOpenShift();
    shiftRoutes();
    await renderSell();

    await openMenu();
    await fireEvent.press(screen.getByTestId('shift-menu-cash_in'));
    await fireEvent.press(await screen.findByTestId('cash-dialog-confirm'));
    expect(screen.getByTestId('cash-amount-error')).toHaveTextContent('Enter an amount.');
    expect(screen.getByTestId('cash-reason-error')).toHaveTextContent('Enter a reason.');
    await fireEvent.changeText(screen.getByTestId('cash-amount'), '500');
    await fireEvent.changeText(screen.getByTestId('cash-reason'), 'Change fund');
    await fireEvent.press(screen.getByTestId('cash-dialog-confirm'));
    // MASTER §6: a save success is a toast.
    await waitFor(() => expect(useToastStore.getState().toast?.message).toBe('Cash in of ₱500.00 recorded.'));

    await openMenu();
    await fireEvent.press(screen.getByTestId('shift-menu-cash_out'));
    await fireEvent.changeText(await screen.findByTestId('cash-amount'), '120.50');
    await fireEvent.changeText(screen.getByTestId('cash-reason'), 'Ice');
    await fireEvent.press(screen.getByTestId('cash-dialog-confirm'));
    await waitFor(() => expect(useToastStore.getState().toast?.message).toBe('Cash out of ₱120.50 recorded.'));

    const movements = await shiftRepository.listCashMovements((await shiftRepository.currentShift(1))!.ulid);
    expect(movements.map((movement) => [movement.type, movement.amountCents, movement.reason])).toEqual([
      ['in', 50000, 'Change fund'],
      ['out', 12050, 'Ice'],
    ]);
    const events = await offlineRepository.listShiftEvents();
    expect(events.map((event) => event.entity)).toEqual(['cash_movement', 'cash_movement']);
  });

  it('X-read: the local report (cash net of change, cash in), printed on the receipt printer', async () => {
    const shift = seedOpenShift({ openingFloatCents: 100000 });
    await offlineRepository.saveSyncedSale(makeOrder({ ulid: '01K6300000000000000000000A', shift_ulid: shift.ulid }), {
      branchId: 1,
      shiftUlid: shift.ulid,
      now: '2026-09-26T01:00:00Z',
    });
    await shiftRepository.addCashMovement({
      ulid: '01K6300000000000000000000M',
      shiftUlid: shift.ulid,
      type: 'in',
      amountCents: 50000,
      reason: 'Change fund',
      occurredAt: '2026-09-26T01:10:00Z',
      user: { id: 3, name: 'Carla Cashier' },
    });
    setOnline(false);
    shiftRoutes();
    await renderSell();

    await openMenu();
    await fireEvent.press(screen.getByTestId('shift-menu-x_read'));
    expect(await screen.findByTestId('x-read-report')).toBeOnTheScreen();
    // 1,000.00 + 157.00 (cash kept after ₱43.00 change) + 500.00 cash in.
    expect(screen.getByTestId('x-read-report-expected-amount')).toHaveTextContent('₱1,657.00');
    expect(screen.getByTestId('x-read-report-net-amount')).toHaveTextContent('₱257.00');

    await fireEvent.press(screen.getByTestId('x-read-print'));
    await settle();
    const [printed] = fake.sentTo(9100);
    expect(decodeEscPos(printed.bytes)).toContain('X-READ');
    expect(decodeEscPos(printed.bytes)).toMatch(/Expected cash\s+1,657\.00/);
  });

  it('closing: counted cash → expected and variance → confirm → the Z-read prints and Sell is back to "Open a shift"', async () => {
    const shift = seedOpenShift({ openingFloatCents: 200000 });
    setOnline(false);
    shiftRoutes();
    await renderSell();

    await openMenu();
    await fireEvent.press(screen.getByTestId('shift-menu-close'));
    expect(await screen.findByTestId('close-expected-amount')).toHaveTextContent('₱2,000.00');
    await fireEvent.press(screen.getByTestId('close-shift-review'));
    expect(screen.getByTestId('close-counted-error')).toHaveTextContent('Enter the cash counted in the drawer.');

    await fireEvent.changeText(screen.getByTestId('close-counted'), '1,950');
    expect(screen.getByTestId('close-variance')).toHaveTextContent('Short ₱50.00');
    await fireEvent.press(screen.getByTestId('close-shift-review'));
    expect(screen.getByTestId('close-confirm-variance')).toHaveTextContent('Short ₱50.00');
    await fireEvent.press(screen.getByTestId('close-shift-confirm'));

    expect(await screen.findByTestId('open-shift-card')).toBeOnTheScreen();
    expect(screen.getByTestId('shift-closed')).toBeOnTheScreen();
    expect(screen.queryByTestId('shift-pill')).toBeNull();
    await settle();

    const stored = await shiftRepository.getShift(shift.ulid);
    expect(stored).toMatchObject({ status: 'closed', countedCashCents: 195000, closedBy: { id: 3, name: 'Carla Cashier' } });
    expect((await offlineRepository.listShiftEvents()).map((event) => event.entity)).toEqual(['shift_close']);
    const zRead = decodeEscPos(fake.sentTo(9100)[0].bytes);
    expect(zRead).toContain('Z-READ');
    expect(zRead).toMatch(/Variance \(Short\)\s+-50\.00/);
    expect(await screen.findByTestId('z-read-status')).toBeOnTheScreen();
  });

  it('closing online sends POST /shifts/{ulid}/close at once', async () => {
    const shift = seedOpenShift();
    const { calls } = shiftRoutes();
    await renderSell();
    await openMenu();
    await fireEvent.press(screen.getByTestId('shift-menu-close'));
    await fireEvent.changeText(await screen.findByTestId('close-counted'), '2000');
    await fireEvent.press(screen.getByTestId('close-shift-review'));
    await fireEvent.press(screen.getByTestId('close-shift-confirm'));
    await waitFor(() => expect(shiftCalls(calls).map((call) => call.path)).toEqual([`/api/v1/shifts/${shift.ulid}/close`]));
    expect(jsonBody(shiftCalls(calls)[0])).toMatchObject({ closed_by: 3, counted_cash_cents: 200000, close_note: null });
    await settle();
  });

  it('closing is blocked while a sale waits for confirmation', async () => {
    seedOpenShift();
    useCartStore.getState().setAwaitingConfirmation(true);
    shiftRoutes();
    await renderSell();
    await openMenu();
    expect(screen.getByTestId('shift-menu-close')).toBeDisabled();
  });
});
