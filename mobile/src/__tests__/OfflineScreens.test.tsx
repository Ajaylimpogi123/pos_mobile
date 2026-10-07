/**
 * Offline Sales screens (docs/api-contract.md → Offline Sales → Device rules):
 * - the unified status pill (Synced · Pending (N) · Syncing · Needs attention (N) · Offline), which opens the Sync queue
 * - the Sync queue: pending and needs-attention sales, Sync now, per-sale Retry
 * - Orders: the day's unsynced local sales first with a badge, their detail from the local JSON
 * - Review (`order.review`): the Needs review filter, the reasons in plain words, Mark reviewed, the dashboard insight
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import OrderRoute from '@/app/(app)/(pos)/orders/[ulid]';
import OrdersIndexRoute from '@/app/(app)/(pos)/orders/index';
import SyncQueueRoute from '@/app/(app)/(pos)/sync-queue';
import { SellHeader } from '@/components/sell/SellHeader';
import { describeSyncStatus } from '@/components/sell/SyncStatusPill';
import { visibleModuleGroups } from '@/constants/modules';
import { ordersNeedingReviewRoute } from '@/constants/routes';
import { offlineRepository } from '@/db/offlineRepository';
import { insightTarget } from '@/hooks/dashboard/dashboardModel';
import type { SellSyncState } from '@/hooks/sell/useSellScreen';
import type { OfflineOrder, PrintableOrder } from '@/services/types';
import { useOfflineStore } from '@/stores/offline';
import { useSessionStore } from '@/stores/session';
import { requestOutboxSync } from '@/sync/outboxSync';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { managerUser, page, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { makeOrder, makeOrderSummary, TEST_SHIFT_ULID } from '@/test-utils/sale';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/sync/outboxSync', () => ({
  ...jest.requireActual<typeof import('@/sync/outboxSync')>('@/sync/outboxSync'),
  requestOutboxSync: jest.fn(async () => ({ outcome: 'offline' })),
}));

const FUTURE = '2099-09-25T01:30:00Z';
/** 10:00 on Fri 25 Sep 2026 in Manila: business date 2026-09-25. */
const NOW = Date.parse('2026-09-25T02:00:00Z');
const ORDERS = '/api/v1/orders';
const LOCAL_ULID = '01K6300000000000000000000A';
const REJECTED_ULID = '01K6300000000000000000000B';
const searchParams = useLocalSearchParams as jest.Mock;

/** Stores an offline sale on the tablet (as the checkout does) for business date 2026-09-25. */
async function saveLocalSale(ulid: string, cashierId = 3): Promise<void> {
  await offlineRepository.saveOfflineSale(
    { ulid, deviceCode: 'T01', businessDate: '2026-09-25', branchId: 1, cashierId, shiftUlid: TEST_SHIFT_ULID, now: '2026-09-25T02:00:00Z', stockDemand: [] },
    (sequence) => {
      const orderNo = `T01-20260925-${String(sequence).padStart(4, '0')}`;
      const order: PrintableOrder = {
        ...makeOrder({ ulid, order_no: orderNo, queue_no: sequence, source: 'offline', business_date: '2026-09-25' }),
        invoice_no: null,
      };
      const payload = { ulid, order_no: orderNo } as OfflineOrder;
      return { order, payload };
    },
  );
}

function listCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method === 'GET' && call.path === ORDERS);
}

function sync(overrides: Partial<SellSyncState> = {}): SellSyncState {
  return {
    status: 'synced',
    error: null,
    syncedLabel: 'Synced just now',
    syncing: false,
    online: true,
    serverReachable: true,
    pending: 0,
    needsAttention: 0,
    outboxSyncing: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await freshTestDatabase();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  secureStoreMock().__resetSecureStore();
  useOfflineStore.getState().reset();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  searchParams.mockReturnValue({});
  (router.push as jest.Mock).mockClear();
  (requestOutboxSync as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('status pill', () => {
  it('shows one state by priority: Offline › Syncing › Needs attention (N) › Pending (N) › Sync failed › Synced', () => {
    expect(describeSyncStatus(sync({ online: false, pending: 3 })).label).toBe('Offline');
    expect(describeSyncStatus(sync({ status: 'offline' })).label).toBe('Offline');
    // Wi-Fi up, server silent (the breaker): Offline too, with the hint.
    expect(describeSyncStatus(sync({ serverReachable: false, pending: 3 }))).toMatchObject({
      label: "Offline · Can't reach the server",
      variant: 'cancelled',
    });
    expect(describeSyncStatus(sync({ outboxSyncing: true, needsAttention: 1 })).label).toBe('Syncing…');
    expect(describeSyncStatus(sync({ status: 'syncing' })).label).toBe('Syncing…');
    expect(describeSyncStatus(sync({ needsAttention: 2, pending: 3 }))).toMatchObject({ label: 'Needs attention (2)', variant: 'cancelled' });
    expect(describeSyncStatus(sync({ pending: 3 }))).toMatchObject({ label: 'Pending (3)', variant: 'pending' });
    expect(describeSyncStatus(sync({ status: 'error', error: 'Server Error.' })).label).toBe('Sync failed');
    expect(describeSyncStatus(sync()).label).toBe('Synced just now');
  });

  it("the Sell header pill says Offline with \"Can't reach the server\" while the breaker is open", async () => {
    await renderWithQuery(<SellHeader sync={sync({ serverReachable: false })} onSyncNow={jest.fn()} />);
    expect(screen.getByTestId('sync-status')).toHaveTextContent(/Offline · Can't reach the server$/);
  });

  it('opens the Sync queue for users with sale.create; read-only otherwise', async () => {
    await renderWithQuery(<SellHeader sync={sync({ pending: 2 })} onSyncNow={jest.fn()} />);
    expect(screen.getByTestId('sync-status')).toHaveTextContent(/Pending \(2\)$/);
    await fireEvent.press(screen.getByTestId('sync-status-open'));
    expect(router.push).toHaveBeenCalledWith('/sync-queue');

    useSessionStore.getState().setSignedIn({ ...cashierUser, permissions: ['report.view'] }, FUTURE);
    await renderWithQuery(<SellHeader sync={sync()} onSyncNow={jest.fn()} />);
    expect(screen.queryByTestId('sync-status-open')).toBeNull();
  });

  it('the Sync module is ready in the sidebar for sale.create', () => {
    const module = visibleModuleGroups(cashierUser)
      .flatMap((group) => group.modules)
      .find((candidate) => candidate.key === 'sync');
    expect(module).toMatchObject({ status: 'ready', route: '/sync-queue' });
  });
});

describe('Sync queue', () => {
  it('lists the pending and needs-attention sales; Retry re-queues a rejected one; Sync now sends at once', async () => {
    await saveLocalSale(LOCAL_ULID);
    await saveLocalSale(REJECTED_ULID);
    await offlineRepository.markRejected(REJECTED_ULID, "Product 999 doesn't exist.", '2026-09-25T02:05:00Z');

    await renderWithQuery(<SyncQueueRoute />);

    const pending = await screen.findByTestId(`sync-item-${LOCAL_ULID}`);
    expect(pending).toHaveTextContent(/T01-20260925-0001/);
    expect(screen.getByTestId(`sync-item-${LOCAL_ULID}-status`)).toHaveTextContent(/Pending$/);
    expect(screen.queryByTestId(`sync-item-${LOCAL_ULID}-retry`)).toBeNull();
    expect(screen.getByTestId(`sync-item-${REJECTED_ULID}-status`)).toHaveTextContent(/Needs attention$/);
    expect(screen.getByTestId(`sync-item-${REJECTED_ULID}-error`)).toHaveTextContent("Product 999 doesn't exist.");
    expect(screen.getByTestId('sync-queue-summary')).toHaveTextContent('1 pending · 1 needs attention');

    await fireEvent.press(screen.getByTestId(`sync-item-${REJECTED_ULID}-retry`));
    await waitFor(() => expect(screen.queryByTestId(`sync-item-${REJECTED_ULID}-retry`)).toBeNull());
    expect((await offlineRepository.getLocalOrder(REJECTED_ULID))?.status).toBe('pending');
    expect(requestOutboxSync).toHaveBeenCalledWith({ force: true });
    expect(useOfflineStore.getState().pending).toBe(2);

    (requestOutboxSync as jest.Mock).mockClear();
    await fireEvent.press(screen.getByTestId('sync-queue-sync-now'));
    expect(requestOutboxSync).toHaveBeenCalledWith({ force: true });

    await fireEvent.press(screen.getByTestId(`sync-item-${LOCAL_ULID}-open`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/orders/[ulid]', params: { ulid: LOCAL_ULID } });
  });

  it('says so when everything is synced', async () => {
    await renderWithQuery(<SyncQueueRoute />);
    expect(await screen.findByTestId('sync-queue-grid-empty')).toHaveTextContent(/Everything is synced/);
  });
});

describe('Orders with local sales', () => {
  it("shows the day's unsynced local sales first with a badge, then the API's orders (a sale the API has shows once)", async () => {
    await saveLocalSale(LOCAL_ULID);
    await saveLocalSale(REJECTED_ULID);
    await offlineRepository.markRejected(REJECTED_ULID, 'Rejected.', '2026-09-25T02:05:00Z');
    const alreadySynced = makeOrderSummary({ ulid: REJECTED_ULID, invoice_no: 'INV-MAIN-00000050' });
    const server = makeOrderSummary();
    routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([alreadySynced, server], null, ORDERS)) }]);

    await renderWithQuery(<OrdersIndexRoute />);

    const local = await screen.findByTestId(`order-card-${LOCAL_ULID}`);
    expect(local).toHaveTextContent(/T01-20260925-0001 \(offline\)/);
    expect(local).toHaveTextContent(/T01-1/);
    expect(screen.getByTestId(`order-card-${LOCAL_ULID}-badge`)).toHaveTextContent(/Not synced yet$/);
    expect(screen.getByTestId(`order-card-${REJECTED_ULID}`)).toHaveTextContent(/INV-MAIN-00000050/);
    expect(screen.queryByTestId(`order-card-${REJECTED_ULID}-badge`)).toBeNull();

    const cards = screen.getAllByTestId(/^order-card-[0-9A-Z]+$/).map((card) => card.props.testID);
    expect(cards[0]).toBe(`order-card-${LOCAL_ULID}`);
  });

  it("a cashier doesn't see another cashier's local sales (the server's visibility rule)", async () => {
    await saveLocalSale(LOCAL_ULID, 7);
    routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([makeOrderSummary()], null, ORDERS)) }]);
    await renderWithQuery(<OrdersIndexRoute />);
    await screen.findByTestId(`order-card-${makeOrderSummary().ulid}`);
    expect(screen.queryByTestId(`order-card-${LOCAL_ULID}`)).toBeNull();
  });

  it('offline, the local sales still show, with why the synced ones are missing', async () => {
    await saveLocalSale(LOCAL_ULID);
    routeFetch([{ method: 'GET', path: ORDERS, reply: () => Promise.reject(new TypeError('Network request failed')) }]);
    await renderWithQuery(<OrdersIndexRoute />);
    expect(await screen.findByTestId(`order-card-${LOCAL_ULID}`)).toBeOnTheScreen();
    expect(await screen.findByTestId('orders-server-error')).toHaveTextContent(/Synced orders couldn't load/);
  });

  it('the detail of an unsynced local sale comes from the local JSON (no request), with its sync state', async () => {
    await saveLocalSale(LOCAL_ULID);
    const { calls } = routeFetch([]);
    searchParams.mockReturnValue({ ulid: LOCAL_ULID });

    await renderWithQuery(<OrderRoute />);

    expect(await screen.findByTestId('order-invoice')).toHaveTextContent('T01-20260925-0001 (offline)');
    expect(screen.getByTestId('order-queue')).toHaveTextContent('T01-1');
    expect(screen.getByTestId('order-local-status')).toHaveTextContent(/Not synced yet$/);
    expect(screen.getByTestId('order-reprint')).toBeOnTheScreen();
    expect(calls).toHaveLength(0);
  });
});

describe('review (order.review)', () => {
  const flagged = makeOrder({
    ulid: '01K6300000000000000000000C',
    order_no: 'T01-20260925-0003',
    source: 'offline',
    needs_review: true,
    review_reasons: ['price_changed', 'oversold', 'something_new'],
    synced_at: '2026-09-25T03:00:00Z',
  });

  it('a manager gets the Needs review filter (every date, needs_review=1); a cashier does not', async () => {
    const { calls } = routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([], null, ORDERS)) }]);
    await renderWithQuery(<OrdersIndexRoute />);
    await screen.findByTestId('orders-grid-empty');
    expect(screen.queryByTestId('orders-needs-review')).toBeNull();

    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    await renderWithQuery(<OrdersIndexRoute />);
    await fireEvent.press(await screen.findByTestId('orders-needs-review'));
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.get('needs_review')).toBe('1'));
    expect(listCalls(calls).at(-1)?.query.has('business_date')).toBe(false);
    expect(await screen.findByTestId('orders-grid-empty')).toHaveTextContent(/No sales need review/);
  });

  it('the dashboard insight opens Orders with the filter on (?review=1)', async () => {
    expect(insightTarget('orders.review', managerUser)).toMatchObject({ label: 'Review sales', route: ordersNeedingReviewRoute() });
    expect(insightTarget('orders.review', cashierUser)).toBeNull();
    expect(ordersNeedingReviewRoute()).toEqual({ pathname: '/orders', params: { review: '1' } });

    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    searchParams.mockReturnValue({ review: '1' });
    const summary = makeOrderSummary({ ulid: flagged.ulid, needs_review: true, source: 'offline', order_no: flagged.order_no });
    const { calls } = routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([summary], null, ORDERS)) }]);
    await renderWithQuery(<OrdersIndexRoute />);

    expect(await screen.findByTestId(`order-card-${flagged.ulid}-needs-review`)).toHaveTextContent(/Needs review$/);
    expect(listCalls(calls)[0].query.get('needs_review')).toBe('1');
    expect(screen.getByTestId('orders-needs-review')).toBeSelected();
  });

  it('shows the reasons in plain words; Mark reviewed sends the note and shows who reviewed it', async () => {
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    searchParams.mockReturnValue({ ulid: flagged.ulid });
    const reviewed = { ...flagged, needs_review: false, reviewed_at: '2026-09-25T04:00:00Z', reviewed_by: { id: 2, name: 'Mia Manager' } };
    const { calls } = routeFetch([
      { method: 'GET', path: `${ORDERS}/${flagged.ulid}`, reply: () => mockResponse(200, { data: flagged }) },
      { method: 'POST', path: `${ORDERS}/${flagged.ulid}/review`, reply: () => mockResponse(200, { data: reviewed }) },
    ]);

    await renderWithQuery(<OrderRoute />);

    const card = await screen.findByTestId('order-review');
    expect(within(card).getByText(/Needs review/)).toBeOnTheScreen();
    expect(screen.getByTestId('order-review-reason-price_changed')).toHaveTextContent(/Price changed during the outage$/);
    expect(screen.getByTestId('order-review-reason-oversold')).toHaveTextContent(/Sold more than the stock on hand$/);
    expect(screen.getByTestId('order-review-reason-something_new')).toHaveTextContent(/something_new$/);
    expect(screen.getByTestId('order-order-no')).toHaveTextContent('Offline sale T01-20260925-0003');

    await fireEvent.press(screen.getByTestId('order-mark-reviewed'));
    await fireEvent.changeText(screen.getByTestId('review-note'), '  Checked with Carla  ');
    await fireEvent.press(screen.getByTestId('review-submit'));

    expect(await screen.findByTestId('order-reviewed-by')).toHaveTextContent(/Reviewed by Mia Manager/);
    const post = calls.find((call) => call.method === 'POST');
    expect(JSON.parse(String(post?.init.body))).toEqual({ note: 'Checked with Carla' });
    expect(screen.queryByTestId('order-mark-reviewed')).toBeNull();
  });

  it('409 "This order doesn\'t need review." shows in the dialog; a cashier never gets the action', async () => {
    useSessionStore.getState().setSignedIn(managerUser, FUTURE);
    searchParams.mockReturnValue({ ulid: flagged.ulid });
    routeFetch([
      { method: 'GET', path: `${ORDERS}/${flagged.ulid}`, reply: () => mockResponse(200, { data: flagged }) },
      { method: 'POST', path: `${ORDERS}/${flagged.ulid}/review`, reply: () => mockResponse(409, { message: "This order doesn't need review." }) },
    ]);
    const view = await renderWithQuery(<OrderRoute />);
    await fireEvent.press(await screen.findByTestId('order-mark-reviewed'));
    await fireEvent.press(screen.getByTestId('review-submit'));
    expect(await screen.findByTestId('review-error')).toHaveTextContent(/This order doesn't need review\./);
    await view.unmount();

    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    await renderWithQuery(<OrderRoute />);
    expect(await screen.findByTestId('order-review')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-mark-reviewed')).toBeNull();
  });
});
