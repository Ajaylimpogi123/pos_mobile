/**
 * Sell screen (Phase 2, read-only): reads only from on-device SQLite (an
 * in-memory SQLite engine here: src/test-utils/database.ts); "Sync now" goes
 * through the real sync runner and the shared API client (fetch is mocked).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import SellRoute from '@/app/(app)/(pos)/sell/index';
import { catalogueRepository } from '@/db/catalogueRepository';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { cashierUser, mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { deferred, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { seedOpenShift } from '@/test-utils/shifts';
import { SERVER_TIME, seedMenu, syncPage, syncProduct } from '@/test-utils/sync';

// The print config (Printing, Phase 4) also syncs on "Sync now"; these tests count catalogue requests only.
jest.mock('@/sync/printConfigSync', () => ({
  requestPrintConfigSync: jest.fn(async () => ({ outcome: 'offline' })),
}));

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const FUTURE = '2026-09-25T01:30:00Z';
const SYNC_PATH = '/api/v1/sync/catalogue';
const getNetworkStateAsync = jest.requireMock('expo-network').getNetworkStateAsync as jest.Mock;

/** The catalogue requests ("Sync now" also refreshes the stock cache since Offline Sales, Phase 5). */
function catalogueCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.path === SYNC_PATH);
}

function syncRoute(reply: Route['reply']): Route {
  return { method: 'GET', path: SYNC_PATH, reply };
}

async function storeMenu(products = seedMenu().products) {
  await catalogueRepository.replaceCatalogue(
    { categories: seedMenu().categories, products },
    { cursor: 'c1', apiOrigin: 'http://192.168.1.50:8000', serverTime: SERVER_TIME },
  );
}

async function renderSell() {
  const result = await render(<SellRoute />);
  await waitFor(() => expect(screen.queryByTestId('sell-loading')).toBeNull());
  return result;
}

function tileIds(): string[] {
  return screen.getAllByTestId(/^product-tile-\d+$/).map((tile) => tile.props.testID);
}

beforeEach(async () => {
  await freshTestDatabase();
  // Phase 6: sales need an open shift on the tablet.
  seedOpenShift();
  useSyncStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  getNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
});

afterEach(() => {
  resetWindowSize();
});

describe('before the first sync', () => {
  it('shows "Menu not synced yet"; Sync now downloads the menu and shows the tiles', async () => {
    const now = new Date().toISOString();
    const { calls } = routeFetch([syncRoute(() => mockResponse(200, syncPage({ ...seedMenu(), meta: { server_time: now } })))]);
    await renderSell();

    expect(screen.getByTestId('sell-not-synced')).toHaveTextContent(/Menu not synced yet/);
    expect(screen.getByTestId('sync-status')).toHaveTextContent(/Not synced yet$/);
    expect(screen.queryByTestId('sell-search')).toBeNull();

    await fireEvent.press(screen.getByTestId('sell-not-synced-action'));

    await waitFor(() => expect(screen.getByTestId('product-tile-1')).toBeOnTheScreen());
    expect(catalogueCalls(calls)).toHaveLength(1);
    expect(catalogueCalls(calls)[0].query.has('cursor')).toBe(false);
    expect(screen.getByTestId('sync-status')).toHaveTextContent(/Synced just now$/);
  });

  it('shows the sync error with a "Sync now" retry when the first sync fails', async () => {
    const { calls } = routeFetch([syncRoute(() => mockResponse(500, { message: 'Server Error.' }))]);
    await renderSell();

    await fireEvent.press(screen.getByTestId('sell-sync-now'));

    const error = await screen.findByTestId('sell-sync-error');
    expect(error).toHaveTextContent(/Couldn't sync the menu/);
    expect(error).toHaveTextContent(/Server Error\./);
    expect(screen.getByTestId('sync-status')).toHaveTextContent(/Sync failed$/);
    const retry = screen.getByTestId('sell-sync-error-retry');
    expect(retry).toHaveTextContent(/Sync now$/);

    await fireEvent.press(retry);
    await waitFor(() => expect(catalogueCalls(calls)).toHaveLength(2));
  });
});

describe('the menu', () => {
  it('tablet landscape: a category rail beside 4 tiles per row, in menu order (sort_order, then name), with prices', async () => {
    await storeMenu();
    await renderSell();

    expect(screen.getByTestId('sell-category-rail')).toBeOnTheScreen();
    expect(screen.getByTestId('sell-category-1')).toHaveTextContent(/Breakfast.*2/);
    // Every seed product has sort_order 0, so they are ordered by name.
    expect(tileIds()).toEqual(['product-tile-5', 'product-tile-1', 'product-tile-3', 'product-tile-2', 'product-tile-4']);
    expect(screen.getByTestId('product-tile-1')).toHaveTextContent(/Egg with Rice/);
    expect(screen.getByTestId('product-tile-1-price')).toHaveTextContent('₱50.00');
    // 5 tiles in rows of 4: the last row is padded with spacers to keep tile widths equal.
    expect(screen.getAllByTestId('sell-tile-cell')).toHaveLength(8);
    expect(screen.getByTestId('sync-status')).toHaveTextContent(/Synced /);
  });

  it('filters by category and searches by name or SKU', async () => {
    await storeMenu();
    await renderSell();

    await fireEvent.press(screen.getByTestId('sell-category-3'));
    await waitFor(() => expect(tileIds()).toEqual(['product-tile-5', 'product-tile-4']));
    expect(screen.getByTestId('sell-category-3')).toBeSelected();

    await fireEvent.press(screen.getByTestId('sell-category-all'));
    await fireEvent.changeText(screen.getByTestId('sell-search'), 'brk-002');
    await waitFor(() => expect(tileIds()).toEqual(['product-tile-2']));

    await fireEvent.changeText(screen.getByTestId('sell-search'), 'nothing like this');
    const empty = await screen.findByTestId('sell-products-empty');
    expect(empty).toHaveTextContent(/No matching items/);
    await fireEvent.press(screen.getByTestId('sell-products-empty-action'));
    await waitFor(() => expect(tileIds()).toHaveLength(5));
  });

  it('falls back to "All items" when a sync deactivates the selected category, and hides its products', async () => {
    await storeMenu();
    await renderSell();
    await fireEvent.press(screen.getByTestId('sell-category-3'));
    await waitFor(() => expect(tileIds()).toEqual(['product-tile-5', 'product-tile-4']));

    await catalogueRepository.applyDeltaPage(
      { categories: [{ ...seedMenu().categories[2], is_active: false }], products: [], deleted: { categories: [], products: [] } },
      { cursor: 'd1', apiOrigin: 'http://192.168.1.50:8000' },
    );
    await act(async () => useSyncStore.getState().markCatalogueChanged());

    await waitFor(() => expect(screen.getByTestId('sell-category-all')).toBeSelected());
    expect(screen.queryByTestId('sell-category-3')).toBeNull();
    expect(tileIds()).toEqual(['product-tile-1', 'product-tile-3', 'product-tile-2']);
  });

  it('greys out unavailable products, marks them disabled and labels them "Unavailable"', async () => {
    const { products } = seedMenu();
    products[1] = syncProduct({ ...products[1], is_available: false });
    await storeMenu(products);
    await renderSell();

    const unavailable = screen.getByTestId('product-tile-2');
    expect(within(unavailable).getByTestId('product-tile-2-unavailable')).toHaveTextContent(/Unavailable$/);
    expect(screen.getByTestId('product-tile-2-body')).toBeDisabled();
    expect(StyleSheet.flatten(screen.getByTestId('product-tile-2-text').props.style).opacity).toBeLessThan(1);
    expect(screen.getByTestId('product-tile-2-body').props.accessibilityLabel).toBe('Hot Dog, ₱80.00, unavailable');

    expect(screen.queryByTestId('product-tile-1-unavailable')).toBeNull();
    expect(screen.getByTestId('product-tile-1-body')).not.toBeDisabled();
    // Unavailable products don't count in the category total.
    expect(screen.getByTestId('sell-category-1')).toHaveTextContent(/Breakfast.*1/);
  });

  it('phone portrait: a category chip row above 2 tiles per row; rotating keeps the search text', async () => {
    setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height);
    await storeMenu();
    await renderSell();

    expect(screen.queryByTestId('sell-category-rail')).toBeNull();
    expect(screen.getByTestId('sell-categorys')).toBeOnTheScreen();
    // 5 tiles in rows of 2.
    expect(screen.getAllByTestId('sell-tile-cell')).toHaveLength(6);

    await fireEvent.changeText(screen.getByTestId('sell-search'), 'tea');
    await waitFor(() => expect(tileIds()).toEqual(['product-tile-4']));

    await act(async () => setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height));
    expect(screen.getByTestId('sell-category-rail')).toBeOnTheScreen();
    expect(screen.getByTestId('sell-search').props.value).toBe('tea');
    expect(tileIds()).toEqual(['product-tile-4']);
  });
});

describe('sync status', () => {
  it('shows "Syncing…" and disables Sync now while a run is in flight', async () => {
    await storeMenu();
    const held = deferred<Response>();
    routeFetch([syncRoute(() => held.promise)]);
    await renderSell();

    await fireEvent.press(screen.getByTestId('sell-sync-now'));
    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent(/Syncing…$/));
    expect(screen.getByTestId('sell-sync-now')).toBeDisabled();

    await act(async () => held.resolve(mockResponse(200, syncPage({ ...seedMenu(), meta: { full: false } }))));
    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent(/Synced /));
    expect(screen.getByTestId('sell-sync-now')).not.toBeDisabled();
  });

  it('offline: shows the Offline chip, skips the request and keeps the menu', async () => {
    await storeMenu();
    const { calls } = routeFetch([]);
    getNetworkStateAsync.mockResolvedValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    await renderSell();

    await fireEvent.press(screen.getByTestId('sell-sync-now'));

    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent(/Offline$/));
    expect(calls).toHaveLength(0);
    expect(tileIds()).toHaveLength(5);
  });

  it('error: keeps the last good menu, with the message and a "Sync now" retry', async () => {
    await storeMenu();
    const { calls } = routeFetch([syncRoute(() => mockResponse(500, { message: 'Server Error.' }))]);
    await renderSell();

    await fireEvent.press(screen.getByTestId('sell-sync-now'));

    const banner = await screen.findByTestId('sell-sync-error');
    expect(banner).toHaveTextContent(/Server Error\./);
    expect(screen.getByTestId('sync-status')).toHaveTextContent(/Sync failed$/);
    expect(tileIds()).toHaveLength(5);

    await fireEvent.press(screen.getByTestId('sell-sync-error-action'));
    await waitFor(() => expect(catalogueCalls(calls)).toHaveLength(2));
  });
});
