/**
 * Sell tile badges (docs/api-contract.md → Inventory (v1 completion) → Sell
 * tile badges): from SQLite `stock_cache` (an in-memory SQLite engine here),
 * a `track_stock` tile shows `Out` at qty ≤ 0 or `Low · n left` at or below
 * its reorder level; none otherwise or without a reorder level. Tiles stay
 * tappable, and the badge follows every cache refresh (`stockVersion`).
 * Also: `/sync/stock` stores `reorder_level` in the cache.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import SellRoute from '@/app/(app)/(pos)/sell/index';
import { catalogueRepository } from '@/db/catalogueRepository';
import { offlineRepository } from '@/db/offlineRepository';
import { resetCart, useCartStore } from '@/stores/cart';
import { useOfflineStore } from '@/stores/offline';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { runStockSync } from '@/sync/stockSync';
import { cashierUser, secureStoreMock } from '@/test-utils';
import { renderWithQuery } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { seedOpenShift } from '@/test-utils/shifts';
import { SERVER_TIME, seedMenu, syncProduct } from '@/test-utils/sync';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

// The stock cache is seeded by each test; no background refresh replaces it.
jest.mock('@/sync/stockSync', () => ({
  ...jest.requireActual('@/sync/stockSync'),
  requestStockSync: jest.fn(async () => ({ outcome: 'skipped' })),
}));

const FUTURE = '2099-09-25T01:30:00Z';

async function storeMenu() {
  const products = [
    ...seedMenu().products,
    syncProduct({ id: 6, category_id: 3, sku: 'DRK-003', name: 'Cola', price_cents: 3000, track_stock: true }),
    syncProduct({ id: 7, category_id: 3, sku: 'DRK-004', name: 'Juice', price_cents: 4000, track_stock: true }),
  ];
  await catalogueRepository.replaceCatalogue(
    { categories: seedMenu().categories, products },
    { cursor: 'c1', apiOrigin: 'http://192.168.1.50:8000', serverTime: SERVER_TIME },
  );
}

async function renderSell() {
  const result = await renderWithQuery(<SellRoute />);
  await waitFor(() => expect(screen.queryByTestId('sell-loading')).toBeNull());
  return result;
}

beforeEach(async () => {
  await freshTestDatabase();
  seedOpenShift();
  useSyncStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  resetCart();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  await storeMenu();
});

describe('Sell tile badges', () => {
  it('Out at qty ≤ 0, "Low · n left" at or below the reorder level, none above it or without a level, none on untracked products', async () => {
    await offlineRepository.replaceStockCache(
      [
        { product_id: 4, qty: 0, reorder_level: null },
        { product_id: 5, qty: 3, reorder_level: 5 },
        { product_id: 6, qty: 20, reorder_level: 5 },
        { product_id: 7, qty: 2, reorder_level: null },
      ],
      SERVER_TIME,
    );
    await renderSell();

    await waitFor(() => expect(screen.getByTestId('product-tile-4-stock')).toHaveTextContent(/Out$/));
    expect(screen.getByTestId('product-tile-5-stock')).toHaveTextContent(/Low · 3 left$/);
    expect(screen.queryByTestId('product-tile-6-stock')).toBeNull();
    // No reorder level: never "Low", however few are left.
    expect(screen.queryByTestId('product-tile-7-stock')).toBeNull();
    // Egg with Rice doesn't track stock.
    expect(screen.queryByTestId('product-tile-1-stock')).toBeNull();
    expect(screen.getByTestId('product-tile-4-body').props.accessibilityLabel).toMatch(/out of stock$/);
    expect(screen.getByTestId('product-tile-5-body').props.accessibilityLabel).toMatch(/low stock, 3 left$/);
  });

  it('a badged tile stays tappable: an Out product still goes into the cart', async () => {
    await offlineRepository.replaceStockCache([{ product_id: 4, qty: -1, reorder_level: 10 }], SERVER_TIME);
    await renderSell();
    await waitFor(() => expect(screen.getByTestId('product-tile-4-stock')).toBeOnTheScreen());

    expect(screen.getByTestId('product-tile-4-body')).not.toBeDisabled();
    await fireEvent.press(screen.getByTestId('product-tile-4-body'));
    expect(useCartStore.getState().lines.map((line) => line.product.id)).toEqual([4]);
  });

  it('the badge follows the cache (stockVersion): Low becomes Out, then clears', async () => {
    await offlineRepository.replaceStockCache([{ product_id: 5, qty: 2, reorder_level: 5 }], SERVER_TIME);
    await renderSell();
    await waitFor(() => expect(screen.getByTestId('product-tile-5-stock')).toHaveTextContent(/Low · 2 left$/));

    await act(async () => {
      await offlineRepository.replaceStockCache([{ product_id: 5, qty: 0, reorder_level: 5 }], SERVER_TIME);
      useOfflineStore.getState().markStockChanged();
    });
    await waitFor(() => expect(screen.getByTestId('product-tile-5-stock')).toHaveTextContent(/Out$/));

    await act(async () => {
      await offlineRepository.replaceStockCache([{ product_id: 5, qty: 48, reorder_level: 5 }], SERVER_TIME);
      useOfflineStore.getState().markStockChanged();
    });
    await waitFor(() => expect(screen.queryByTestId('product-tile-5-stock')).toBeNull());
  });
});

describe('GET /sync/stock → stock_cache', () => {
  it('stores reorder_level (an older server without it reads as null)', async () => {
    const result = await runStockSync({
      fetchLevels: async () => ({
        levels: [
          { product_id: 4, qty: 9, reorder_level: 10 },
          { product_id: 5, qty: 3 } as unknown as { product_id: number; qty: number; reorder_level: number | null },
        ],
        server_time: SERVER_TIME,
      }),
      repository: offlineRepository,
      isOnline: async () => true,
      isSignedIn: () => true,
      prepareDatabase: async () => true,
    });

    expect(result.outcome).toBe('synced');
    const badges = await offlineRepository.readStockBadges([4, 5]);
    expect(badges.get(4)).toEqual({ qty: 9, reorderLevel: 10 });
    expect(badges.get(5)).toEqual({ qty: 3, reorderLevel: null });
  });
});

describe('§J recipe tiles: Check stock', () => {
  it('a recipe product whose status is check shows "Check stock"; ok shows nothing; the tile stays tappable', async () => {
    await offlineRepository.replaceStockCache([], SERVER_TIME, [
      { product_id: 1, status: 'check' },
      { product_id: 2, status: 'ok' },
    ]);
    await renderSell();

    await waitFor(() => expect(screen.getByTestId('product-tile-1-recipe-check')).toHaveTextContent(/Check stock$/));
    expect(screen.queryByTestId('product-tile-2-recipe-check')).toBeNull();
    expect(screen.queryByTestId('product-tile-3-recipe-check')).toBeNull();
    expect(screen.getByTestId('product-tile-1-body').props.accessibilityLabel).toMatch(/check stock$/);

    expect(screen.getByTestId('product-tile-1-body')).not.toBeDisabled();
    await fireEvent.press(screen.getByTestId('product-tile-1-body'));
    expect(useCartStore.getState().lines.map((line) => line.product.id)).toEqual([1]);
  });

  it('follows the cache: check clears when the next snapshot says ok', async () => {
    await offlineRepository.replaceStockCache([], SERVER_TIME, [{ product_id: 3, status: 'check' }]);
    await renderSell();
    await waitFor(() => expect(screen.getByTestId('product-tile-3-recipe-check')).toBeOnTheScreen());

    await act(async () => {
      await offlineRepository.replaceStockCache([], SERVER_TIME, [{ product_id: 3, status: 'ok' }]);
      useOfflineStore.getState().markStockChanged();
    });
    await waitFor(() => expect(screen.queryByTestId('product-tile-3-recipe-check')).toBeNull());
  });

  it('GET /sync/stock stores recipes[] (unknown statuses dropped; an older server without recipes clears them)', async () => {
    const deps = (recipes: unknown) => ({
      fetchLevels: async () => ({ levels: [{ product_id: 4, qty: 9, reorder_level: null }], recipes, server_time: SERVER_TIME }) as never,
      repository: offlineRepository,
      isOnline: async () => true,
      isSignedIn: () => true,
      prepareDatabase: async () => true,
    });

    expect((await runStockSync(deps([{ product_id: 1, status: 'check' }, { product_id: 2, status: 'weird' }, { product_id: 3, status: 'ok' }]))).outcome).toBe('synced');
    expect([...(await offlineRepository.readRecipeChecks([1, 2, 3]))]).toEqual([1]);

    expect((await runStockSync(deps(undefined))).outcome).toBe('synced');
    expect((await offlineRepository.readRecipeChecks([1, 2, 3])).size).toBe(0);
    expect((await offlineRepository.readStockBadges([4])).get(4)).toEqual({ qty: 9, reorderLevel: null });
  });
});
