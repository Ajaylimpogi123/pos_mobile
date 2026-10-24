/**
 * Inventory list (docs/api-contract.md → Inventory (v1 completion) → GET
 * /api/v1/inventory and Device rules → Inventory list): the summary counts,
 * the segmented status filter (and the dashboard's `alerts` view), the pill
 * search, category chips, the cards, every list state, offline, and opening
 * a product.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import InventoryIndexRoute from '@/app/(app)/(admin)/inventory/index';
import { useSessionStore } from '@/stores/session';
import { mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { makeCategory, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { inventoryPage, makeInventoryItem } from '@/test-utils/inventory';

const FUTURE = '2099-09-25T01:30:00Z';
const INVENTORY = '/api/v1/inventory';
const useNetworkState = jest.requireMock('expo-network').useNetworkState as jest.Mock;

const icedTea = makeInventoryItem();
const water = makeInventoryItem({
  product_id: 10,
  name: 'Bottled Water',
  sku: null,
  qty: 0,
  reorder_level: null,
  status: 'out',
  cost_cents: 800,
  stock_value_cents: 0,
  is_available: false,
});
const cola = makeInventoryItem({ product_id: 11, name: 'Cola', qty: 40, reorder_level: 12, status: 'in_stock', stock_value_cents: 48000 });

const categoriesRoute: Route = {
  method: 'GET',
  path: '/api/v1/admin/categories',
  reply: () => mockResponse(200, page([makeCategory({ id: 3, name: 'Drinks' }), makeCategory({ id: 4, name: 'Snacks' })], null, '/api/v1/admin/categories')),
};

function listCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.path === INVENTORY);
}

async function renderList() {
  const result = await renderWithQuery(<InventoryIndexRoute />);
  await waitFor(() => expect(screen.queryByTestId('inventory-grid-loading')).toBeNull());
  return result;
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  (router.push as jest.Mock).mockClear();
  useNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
});

describe('the list', () => {
  it('asks for every status; shows the summary counts and each card (qty, status chip, reorder level, value)', async () => {
    const { calls } = routeFetch([categoriesRoute, { method: 'GET', path: INVENTORY, reply: () => mockResponse(200, inventoryPage([icedTea, water, cola])) }]);
    await renderList();

    const [first] = listCalls(calls);
    expect(first.query.get('per_page')).toBe('25');
    expect(first.query.has('status')).toBe(false);
    expect(screen.getByTestId('inventory-band-subtitle')).toHaveTextContent(/^24 tracked products · /);
    expect(screen.getByTestId('inventory-segment-low')).toHaveTextContent('Low (3)');
    expect(screen.getByTestId('inventory-segment-out')).toHaveTextContent('Out (1)');
    expect(screen.queryByTestId('inventory-segment-alerts')).toBeNull();

    expect(screen.getByTestId('inventory-card-9-qty')).toHaveTextContent('9');
    expect(screen.getByTestId('inventory-card-9-status')).toHaveTextContent('Low');
    expect(screen.getByTestId('inventory-card-9-reorder')).toHaveTextContent('Reorder at 10');
    expect(screen.getByTestId('inventory-card-9-value')).toHaveTextContent('₱108.00');
    expect(screen.getByTestId('inventory-card-10-status')).toHaveTextContent('Out');
    expect(screen.getByTestId('inventory-card-10-reorder')).toHaveTextContent('No reorder level');
    expect(screen.getByTestId('inventory-card-10-unavailable')).toBeOnTheScreen();
    expect(screen.getByTestId('inventory-card-11-status')).toHaveTextContent('In stock');
    // Category chips come from the admin categories (the manager has product.manage).
    expect(screen.getByTestId('inventory-category-3')).toHaveTextContent('Drinks');
  });

  it('shows the summary cards (Tracked · Low stock · Out of stock) above the table', async () => {
    routeFetch([categoriesRoute, { method: 'GET', path: INVENTORY, reply: () => mockResponse(200, inventoryPage([icedTea, water, cola])) }]);
    await renderList();

    expect(screen.getByTestId('inventory-summary-tracked')).toHaveTextContent(/Trackeds*24/);
    expect(screen.getByTestId('inventory-summary-low')).toHaveTextContent(/Low stocks*3/);
    expect(screen.getByTestId('inventory-summary-out')).toHaveTextContent(/Out of stocks*1/);
    expect(screen.getByTestId('inventory-grid-header')).toBeOnTheScreen();
  });

  it('phones show the stock cards instead of the table', async () => {
    setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height);
    try {
      routeFetch([categoriesRoute, { method: 'GET', path: INVENTORY, reply: () => mockResponse(200, inventoryPage([icedTea])) }]);
      await renderList();

      expect(screen.getByTestId('inventory-card-9-qty')).toHaveTextContent('9');
      expect(screen.queryByTestId('inventory-grid-header')).toBeNull();
      expect(screen.getByTestId('inventory-summary-low')).toHaveTextContent(/Lows*3/);
    } finally {
      resetWindowSize();
    }
  });

  it('filters: Low → status=low, Out → status=out, a category chip → category_id, and the search (debounced)', async () => {
    const { calls } = routeFetch([categoriesRoute, { method: 'GET', path: INVENTORY, reply: () => mockResponse(200, inventoryPage([icedTea])) }]);
    await renderList();

    await fireEvent.press(screen.getByTestId('inventory-segment-low'));
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.get('status')).toBe('low'));
    await fireEvent.press(screen.getByTestId('inventory-segment-out'));
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.get('status')).toBe('out'));
    await fireEvent.press(screen.getByTestId('inventory-category-3'));
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.get('category_id')).toBe('3'));
    await fireEvent.changeText(screen.getByTestId('inventory-search'), '  tea ');
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.get('search')).toBe('tea'));
    expect(listCalls(calls).at(-1)?.query.get('status')).toBe('out');
    expect(screen.getByTestId('inventory-search').props.maxLength).toBe(100);

    await fireEvent.press(screen.getByTestId('inventory-segment-all'));
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.has('status')).toBe(false));
  });

  it('the dashboard alerts view (?status=alerts) asks for status=alerts and shows "Low & out (4)"', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ status: 'alerts' });
    const { calls } = routeFetch([categoriesRoute, { method: 'GET', path: INVENTORY, reply: () => mockResponse(200, inventoryPage([icedTea, water])) }]);
    await renderList();

    expect(listCalls(calls)[0].query.get('status')).toBe('alerts');
    expect(screen.getByTestId('inventory-segment-alerts')).toHaveTextContent('Low & out (4)');
  });

  it('loads the next page on scroll; the summary still comes from meta.summary', async () => {
    const { calls } = routeFetch([
      categoriesRoute,
      {
        method: 'GET',
        path: INVENTORY,
        reply: (call) =>
          mockResponse(200, call.query.get('cursor') === 'CUR2' ? inventoryPage([cola], null) : inventoryPage([icedTea, water], 'CUR2')),
      },
    ]);
    await renderList();

    await act(async () => {
      fireEvent(screen.getByTestId('inventory-grid'), 'onEndReached');
    });
    expect(await screen.findByTestId('inventory-card-11')).toBeOnTheScreen();
    expect(listCalls(calls).map((call) => call.query.get('cursor'))).toEqual([null, 'CUR2']);
  });

  it('opens a product on tap', async () => {
    routeFetch([categoriesRoute, { method: 'GET', path: INVENTORY, reply: () => mockResponse(200, inventoryPage([icedTea])) }]);
    await renderList();

    await fireEvent.press(screen.getByTestId('inventory-card-9-open'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/inventory/[productId]', params: { productId: '9' } });
  });
});

describe('list states', () => {
  it('empty: "No tracked products"; filtered empty offers Clear filters', async () => {
    const { calls } = routeFetch([
      categoriesRoute,
      { method: 'GET', path: INVENTORY, reply: () => mockResponse(200, inventoryPage([], null, { tracked: 0, low: 0, out: 0 })) },
    ]);
    await renderList();

    expect(screen.getByTestId('inventory-grid-empty')).toHaveTextContent(/No tracked products/);
    await fireEvent.press(screen.getByTestId('inventory-segment-low'));
    await waitFor(() => expect(screen.getByTestId('inventory-grid-empty')).toHaveTextContent(/No matching products/));
    await fireEvent.press(within(screen.getByTestId('inventory-grid-empty')).getByText('Clear filters'));
    await waitFor(() => expect(listCalls(calls).at(-1)?.query.has('status')).toBe(false));
  });

  it('an error shows its message with Retry; a 403 says "No access"', async () => {
    let reply = 500;
    const { calls } = routeFetch([
      categoriesRoute,
      {
        method: 'GET',
        path: INVENTORY,
        reply: () => (reply === 200 ? mockResponse(200, inventoryPage([icedTea])) : mockResponse(reply, { message: reply === 403 ? 'This action is unauthorized.' : 'Server Error.' })),
      },
    ]);
    await renderList();

    expect(screen.getByTestId('inventory-grid-error')).toHaveTextContent(/Server Error\./);
    reply = 200;
    await fireEvent.press(within(screen.getByTestId('inventory-grid-error')).getByText('Retry'));
    expect(await screen.findByTestId('inventory-card-9')).toBeOnTheScreen();
    expect(listCalls(calls)).toHaveLength(2);
  });

  it('a 403 reads as "No access"', async () => {
    routeFetch([categoriesRoute, { method: 'GET', path: INVENTORY, reply: () => mockResponse(403, { message: 'This action is unauthorized.' }) }]);
    await renderList();
    expect(screen.getByTestId('inventory-grid-error')).toHaveTextContent(/No access/);
  });

  it('offline: "Inventory needs a connection."', async () => {
    useNetworkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    routeFetch([categoriesRoute, { method: 'GET', path: INVENTORY, reply: () => Promise.reject(new TypeError('Network request failed')) }]);
    await renderWithQuery(<InventoryIndexRoute />);

    expect(await screen.findByTestId('inventory-offline')).toHaveTextContent(/Inventory needs a connection\./);
    expect(screen.queryByTestId('inventory-grid')).toBeNull();
  });

  it('without product.manage, the category chips come from the read endpoint', async () => {
    useSessionStore.getState().setSignedIn({ ...managerUser, permissions: ['report.view'] }, FUTURE);
    const { calls } = routeFetch([
      { method: 'GET', path: '/api/v1/categories', reply: () => mockResponse(200, page([makeCategory({ id: 3, name: 'Drinks' })], null, '/api/v1/categories')) },
      { method: 'GET', path: INVENTORY, reply: () => mockResponse(200, inventoryPage([icedTea])) },
    ]);
    await renderList();

    expect(await screen.findByTestId('inventory-category-3')).toBeOnTheScreen();
    expect(calls.some((call) => call.path === '/api/v1/admin/categories')).toBe(false);
  });
});
