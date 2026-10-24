/**
 * Checkout offline (docs/api-contract.md → Offline Sales → Device rules):
 * online first, offline fallback.
 * - Offline: the sale is saved on the tablet (one transaction) and prints at once.
 * - A timeout on POST /orders falls back to the tablet with the **same ULID**.
 * - A 4xx never falls back.
 * - Blocked offline: a discount that needs approval; a tablet that never registered.
 * - Offline stock warnings and the customer picker.
 */
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react-native';

import CheckoutRoute from '@/app/(app)/(pos)/sell/checkout';
import { CustomerPickerDialog } from '@/components/sell/CustomerPickerDialog';
import { catalogueRepository } from '@/db/catalogueRepository';
import { offlineRepository } from '@/db/offlineRepository';
import { printRepository } from '@/db/printRepository';
import { useStockWarnings } from '@/hooks/sell/useStockWarnings';
import { resetPrintingForTests, whenPrintQueueIdle } from '@/printing/printActions';
import { getPrintTransport } from '@/printing/transport';
import { REQUEST_TIMEOUT_MS } from '@/services/api';
import { CREATE_ORDER_TIMEOUT_MS } from '@/services/orders';
import type { OfflineOrder } from '@/services/types';
import { resetCart, useCartStore } from '@/stores/cart';
import { useDeviceStore } from '@/stores/device';
import { useOfflineStore } from '@/stores/offline';
import { usePrintingStore } from '@/stores/printing';
import { useConnectivityStore } from '@/stores/connectivity';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { requestOutboxSync } from '@/sync/outboxSync';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { seedOpenShift, TEST_SHIFT_ULID } from '@/test-utils/shifts';
import { decodeEscPos } from '@/test-utils/escpos';
import { createFakeTransport, makePrintConfig, type FakeTransport } from '@/test-utils/printing';
import { fillCartWithExampleB, HOT_DOG, ICED_TEA } from '@/test-utils/sale';
import { seedMenu } from '@/test-utils/sync';
import { businessDateAt } from '@pos/core/businessDay';

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

// Whole checkouts through SQLite, printing and the UI: slower than the default 15 s on a cold run.
jest.setTimeout(45_000);

const FUTURE = '2099-09-25T01:30:00Z';
const ORDERS = '/api/v1/orders';
const ORIGIN = 'http://192.168.1.50:8000';
const network = jest.requireMock('expo-network') as { useNetworkState: jest.Mock; getNetworkStateAsync: jest.Mock };
let fake: FakeTransport;

function setOnline(online: boolean) {
  const state = online
    ? { isConnected: true, isInternetReachable: true, type: 'WIFI' }
    : { isConnected: false, isInternetReachable: false, type: 'NONE' };
  network.useNetworkState.mockReturnValue(state);
  network.getNetworkStateAsync.mockResolvedValue(state);
}

async function registerTablet() {
  await secureStoreMock().setItemAsync('pos.device.registered', JSON.stringify({ id: 1, code: 'T01', apiOrigin: ORIGIN, branchId: 1 }));
}

function todayOrderNo(sequence: number): string {
  const date = businessDateAt(Date.now(), 'Asia/Manila', '04:00').replace(/-/g, '');
  return `T01-${date}-${String(sequence).padStart(4, '0')}`;
}

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

async function settlePrinting() {
  await act(async () => {
    await whenPrintQueueIdle();
  });
}

beforeEach(async () => {
  await freshTestDatabase();
  // Phase 6: sales need an open shift on the tablet.
  seedOpenShift();
  await catalogueRepository.replaceCatalogue(seedMenu(), { cursor: 'c1', apiOrigin: ORIGIN, serverTime: '2026-09-26T00:00:00Z' });
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  usePrintingStore.getState().setConfig(makePrintConfig());
  useSyncStore.getState().reset();
  useDeviceStore.getState().reset();
  useOfflineStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  resetCart();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  // A timeout opens the server-reachability breaker: every test starts with the server reachable.
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

describe('offline', () => {
  it('saves the sale on the tablet, shows "No connection — sale saved on this tablet." and prints it with its order_no', async () => {
    setOnline(false);
    await registerTablet();
    fillCartWithExampleB();
    const { calls } = routeFetch([]);
    await renderCheckout();
    await expectMessage('checkout-offline', 'No connection. This sale will be saved on this tablet and synced later.');

    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    await expectMessage('sale-note', 'No connection — sale saved on this tablet.');
    expect(screen.getByTestId('sale-invoice')).toHaveTextContent(todayOrderNo(1));
    expect(screen.getByTestId('sale-queue')).toHaveTextContent('T01-1');
    expect(orderCalls(calls)).toHaveLength(0);

    // One local order and its outbox row, with the same ULID; the cart starts a new sale.
    const [record] = await offlineRepository.listLocalOrders();
    expect(record).toMatchObject({ status: 'pending', orderNo: todayOrderNo(1), cashierId: 3, branchId: 1 });
    const [entry] = await offlineRepository.nextBatch(50, '2999-01-01T00:00:00Z', false);
    expect(entry.ulid).toBe(record.ulid);
    expect(entry.payload).toMatchObject<Partial<OfflineOrder>>({ order_no: todayOrderNo(1), cashier_id: 3, client_total_cents: 25700 });
    // Phase 6: the offline sale carries the tablet's open shift, in the OfflineOrder and on the local row.
    expect(entry.payload).toMatchObject<Partial<OfflineOrder>>({ shift_ulid: TEST_SHIFT_ULID });
    expect(record.shiftUlid).toBe(TEST_SHIFT_ULID);
    expect(useCartStore.getState().lines).toHaveLength(0);
    expect(useCartStore.getState().pendingUlid).toBeNull();
    expect(requestOutboxSync).toHaveBeenCalled();
    await waitFor(() => expect(useOfflineStore.getState().pending).toBe(1));

    // Printed at once through the same queue: the receipt shows the offline number, the kitchen `T01-1`.
    await settlePrinting();
    const receipt = decodeEscPos(fake.sentTo(9100)[0].bytes);
    expect(receipt).toContain(`${todayOrderNo(1)} (offline)`);
    const kitchen = decodeEscPos(fake.sentTo(9101)[0].bytes);
    expect(kitchen).toContain('T01-1');
    const jobs = await printRepository.jobsForOrder(record.ulid);
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('numbers the next offline sale of the day with the next sequence', async () => {
    setOnline(false);
    await registerTablet();
    routeFetch([]);
    for (const sequence of [1, 2]) {
      useCartStore.getState().addProduct(HOT_DOG);
      const view = await renderCheckout();
      await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
      await fireEvent.press(screen.getByTestId('checkout-confirm'));
      expect(await screen.findByTestId('sale-invoice')).toHaveTextContent(todayOrderNo(sequence));
      await settlePrinting();
      await view.unmount();
    }
  });

  it('a discount that needs approval is blocked: "Needs a manager approval — connect to the internet."', async () => {
    setOnline(false);
    await registerTablet();
    useCartStore.getState().addProduct(HOT_DOG);
    useCartStore.getState().setOrderDiscount({ type: 'manual', kind: 'percent', value: 2000 });
    routeFetch([]);
    await renderCheckout();
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));

    await expectMessage('checkout-offline', 'Needs a manager approval — connect to the internet.');
    expect(screen.getByTestId('checkout-confirm')).toBeDisabled();
    expect(screen.queryByTestId('approval-dialog')).toBeNull();
    expect(await offlineRepository.listLocalOrders()).toHaveLength(0);
  });
});

describe('online first, offline fallback', () => {
  it('a timeout saves the sale on the tablet with the SAME ULID the request was sent with', async () => {
    jest.useFakeTimers();
    await registerTablet();
    fillCartWithExampleB();
    const { calls } = routeFetch([
      {
        method: 'POST',
        path: ORDERS,
        reply: (call) =>
          new Promise<Response>((_resolve, reject) => {
            call.init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
          }),
      },
    ]);
    await renderCheckout();
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));
    await act(async () => {
      jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    });

    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    await expectMessage('sale-note', 'No connection — sale saved on this tablet.');
    const [attempt] = orderCalls(calls);
    const key = (attempt.init.headers as Record<string, string>)['Idempotency-Key'];
    const [record] = await offlineRepository.listLocalOrders();
    expect(record.ulid).toBe(key);
    const [entry] = await offlineRepository.nextBatch(50, '2999-01-01T00:00:00Z', false);
    expect(entry.payload.ulid).toBe(key);
    expect(orderCalls(calls)).toHaveLength(1);
  });

  it('POST /orders gives up after 8 s (not 15 s), then falls back', async () => {
    jest.useFakeTimers();
    await registerTablet();
    useCartStore.getState().addProduct(HOT_DOG);
    routeFetch([
      {
        method: 'POST',
        path: ORDERS,
        reply: (call) =>
          new Promise<Response>((_resolve, reject) => {
            call.init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
          }),
      },
    ]);
    await renderCheckout();
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await act(async () => {
      jest.advanceTimersByTime(CREATE_ORDER_TIMEOUT_MS - 1);
    });
    expect(screen.queryByTestId('sale-complete')).toBeNull();
    expect(useConnectivityStore.getState().serverReachable).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    expect(CREATE_ORDER_TIMEOUT_MS).toBe(8_000);
  });

  it('breaker: after a timeout the server counts as unreachable, and the next sale saves offline at once with no request', async () => {
    jest.useFakeTimers();
    await registerTablet();
    useCartStore.getState().addProduct(HOT_DOG);
    const { calls } = routeFetch([
      {
        method: 'POST',
        path: ORDERS,
        reply: (call) =>
          new Promise<Response>((_resolve, reject) => {
            call.init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
          }),
      },
    ]);
    const first = await renderCheckout();
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));
    await act(async () => {
      jest.advanceTimersByTime(CREATE_ORDER_TIMEOUT_MS);
    });
    expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
    expect(useConnectivityStore.getState().serverReachable).toBe(false);
    await settlePrinting();
    await first.unmount();

    // The Wi-Fi is still up: only the breaker says offline.
    useCartStore.getState().addProduct(HOT_DOG);
    await renderCheckout();
    await expectMessage('checkout-offline', 'No connection. This sale will be saved on this tablet and synced later.');
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    expect(await screen.findByTestId('sale-invoice')).toHaveTextContent(todayOrderNo(2));
    expect(orderCalls(calls)).toHaveLength(1);
    expect(await offlineRepository.listLocalOrders()).toHaveLength(2);
  });

  it('breaker: a discount that needs approval is blocked, and the customer picker says it needs a connection', async () => {
    useConnectivityStore.getState().setServerReachable(false);
    await registerTablet();
    useCartStore.getState().addProduct(HOT_DOG);
    useCartStore.getState().setOrderDiscount({ type: 'manual', kind: 'percent', value: 2000 });
    const { calls } = routeFetch([]);
    await renderCheckout();
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await expectMessage('checkout-offline', 'Needs a manager approval — connect to the internet.');
    expect(screen.getByTestId('checkout-confirm')).toBeDisabled();

    await renderWithQuery(<CustomerPickerDialog current={null} onChoose={jest.fn()} onClose={jest.fn()} />);
    expect(await screen.findByTestId('customer-picker-offline')).toBeOnTheScreen();
    expect(calls).toHaveLength(0);
  });

  it('a network error on a tablet that never registered keeps the Phase 3 retry and says why', async () => {
    fillCartWithExampleB();
    routeFetch([{ method: 'POST', path: ORDERS, reply: () => Promise.reject(new TypeError('Network request failed')) }]);
    await renderCheckout();
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await expectMessage('checkout-banner', "We couldn't confirm the sale. Retry.");
    await expectMessage('checkout-banner-detail', 'Connect once to set up offline sales.');
    expect(useCartStore.getState().awaitingConfirmation).toBe(true);
    expect(await offlineRepository.listLocalOrders()).toHaveLength(0);
  });

  it('a 4xx never falls back: a stock 422 goes back to the cart and nothing is saved on the tablet', async () => {
    await registerTablet();
    fillCartWithExampleB();
    routeFetch([
      {
        method: 'POST',
        path: ORDERS,
        reply: () =>
          mockResponse(422, {
            message: 'Only 2 "Iced Tea" left in stock.',
            errors: { 'items.2.qty': ['Only 2 "Iced Tea" left in stock.'] },
          }),
      },
    ]);
    await renderCheckout();
    await fireEvent.press(screen.getByTestId('checkout-cash-exact'));
    await fireEvent.press(screen.getByTestId('checkout-confirm'));

    await waitFor(() => expect(Object.values(useCartStore.getState().lineErrors)).toContain('Only 2 "Iced Tea" left in stock.'));
    expect(screen.queryByTestId('sale-complete')).toBeNull();
    expect(await offlineRepository.listLocalOrders()).toHaveLength(0);
  });
});

describe('offline stock and customers', () => {
  it('offline, a line over the cached level warns "Only 2 left (offline estimate)"; online it says nothing', async () => {
    await offlineRepository.replaceStockCache([{ product_id: ICED_TEA.id, qty: 2, reorder_level: null }], '2026-09-26T01:00:00Z');
    fillCartWithExampleB();
    setOnline(false);
    const { result, rerender } = await renderHook(() => useStockWarnings(useCartStore.getState().lines));
    const tea = useCartStore.getState().lines.find((line) => line.product.id === ICED_TEA.id);
    await waitFor(() => expect(result.current[tea?.key ?? '']).toBe('Only 2 left (offline estimate)'));
    expect(Object.keys(result.current)).toHaveLength(1);

    setOnline(true);
    await rerender({});
    expect(result.current).toEqual({});
  });

  it('offline, the customer picker says it needs a connection and fetches nothing', async () => {
    setOnline(false);
    const { calls } = routeFetch([]);
    await renderWithQuery(<CustomerPickerDialog current={{ id: 12, full_name: 'Maria Santos' }} onChoose={jest.fn()} onClose={jest.fn()} />);

    expect(await screen.findByTestId('customer-picker-offline')).toBeOnTheScreen();
    expect(screen.getByTestId('customer-picker-none')).toBeOnTheScreen();
    expect(calls).toHaveLength(0);
  });
});
