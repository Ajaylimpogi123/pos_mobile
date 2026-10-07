/**
 * The SQLite side of the catalogue sync, on a real in-memory SQLite engine
 * (node:sqlite behind the expo-sqlite API: src/test-utils/database.ts):
 * atomic baseline replace, delta upsert + tombstones, the cursor saved in the
 * same transaction as its page, and the app wiring end to end through the
 * shared API client (a 401 signs out but keeps the catalogue).
 */
import { router } from 'expo-router';

import { catalogueRepository, type SyncPosition } from '@/db/catalogueRepository';
import { categories, products } from '@/db/schema';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { requestCatalogueSync } from '@/sync/catalogueSync';
import { cashierUser, flushTimers, mockResponse, secureStoreMock } from '@/test-utils';
import { routeFetch } from '@/test-utils/catalog';
import { currentTestDatabase, freshTestDatabase } from '@/test-utils/database';
import { SERVER_TIME, seedMenu, syncCategory, syncPage, syncProduct } from '@/test-utils/sync';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const ORIGIN = 'http://192.168.1.50:8000';
const FUTURE = '2026-09-25T01:30:00Z';
const position = (cursor: string, serverTime?: string): SyncPosition => ({ cursor, apiOrigin: ORIGIN, serverTime });

function productIds(): number[] {
  return currentTestDatabase()
    .select({ id: products.id })
    .from(products)
    .all()
    .map((row) => row.id)
    .sort((a, b) => a - b);
}

function categoryIds(): number[] {
  return currentTestDatabase()
    .select({ id: categories.id })
    .from(categories)
    .all()
    .map((row) => row.id)
    .sort((a, b) => a - b);
}

beforeEach(async () => {
  await freshTestDatabase();
  useSyncStore.getState().reset();
});

describe('baseline replace', () => {
  it('replaces both tables and saves the cursor, origin and server time together', async () => {
    await catalogueRepository.replaceCatalogue(seedMenu(), position('c1', '2026-09-24T00:00:00Z'));
    await catalogueRepository.replaceCatalogue(
      { categories: [syncCategory({ id: 9 })], products: [syncProduct({ id: 90, category_id: 9 })] },
      position('c2', SERVER_TIME),
    );

    expect(categoryIds()).toEqual([9]);
    expect(productIds()).toEqual([90]);
    expect(await catalogueRepository.readSyncState()).toEqual({
      scope: 'catalogue',
      cursor: 'c2',
      api_origin: ORIGIN,
      server_time: SERVER_TIME,
    });
  });

  it('is atomic: a failure partway leaves the old menu and the old cursor', async () => {
    await catalogueRepository.replaceCatalogue(seedMenu(), position('c1', SERVER_TIME));
    const broken = syncProduct({ id: 99, category_id: 1, name: null as unknown as string }); // NOT NULL violation

    await expect(
      catalogueRepository.replaceCatalogue(
        { categories: [syncCategory({ id: 9 })], products: [syncProduct({ id: 98, category_id: 9 }), broken] },
        position('c2', '2026-09-24T02:00:00Z'),
      ),
    ).rejects.toThrow();

    expect(categoryIds()).toEqual([1, 2, 3]);
    expect(productIds()).toEqual([1, 2, 3, 4, 5]);
    expect(await catalogueRepository.readSyncState()).toMatchObject({ cursor: 'c1', server_time: SERVER_TIME });
  });

  it('stores exactly the contract fields (booleans as booleans, money as integer centavos)', async () => {
    await catalogueRepository.replaceCatalogue(
      { categories: [syncCategory({ id: 1, is_active: false })], products: [syncProduct({ id: 7, category_id: 1, price_cents: 5050, is_available: false })] },
      position('c1', SERVER_TIME),
    );

    const [row] = currentTestDatabase().select().from(products).all();
    expect(row).toEqual({
      id: 7,
      category_id: 1,
      sku: null,
      name: 'Product 7',
      description: null,
      price_cents: 5050,
      is_vatable: true,
      is_available: false,
      track_stock: false,
      sort_order: 0,
      image_url: null,
      image_path: null,
      updated_at: '2026-09-24T01:00:00Z',
    });
    expect(currentTestDatabase().select().from(categories).all()[0].is_active).toBe(false);
  });
});

describe('delta pages', () => {
  it('upserts rows, deletes tombstones (unknown ids are ignored) and saves the page cursor in the same transaction', async () => {
    await catalogueRepository.replaceCatalogue(seedMenu(), position('c1', SERVER_TIME));

    await catalogueRepository.applyDeltaPage(
      {
        categories: [syncCategory({ id: 2, name: 'Meals & More', sort_order: 20 }), syncCategory({ id: 4, name: 'Desserts' })],
        products: [syncProduct({ id: 1, category_id: 1, name: 'Egg with Rice', price_cents: 5500 }), syncProduct({ id: 6, category_id: 4 })],
        deleted: { categories: [3, 404], products: [4, 5, 505] },
      },
      position('d1'),
    );

    expect(categoryIds()).toEqual([1, 2, 4]);
    expect(productIds()).toEqual([1, 2, 3, 6]);
    const egg = currentTestDatabase().select().from(products).all().find((row) => row.id === 1);
    expect(egg?.price_cents).toBe(5500);
    // Mid-run page: the cursor moves, "synced at" doesn't.
    expect(await catalogueRepository.readSyncState()).toMatchObject({ cursor: 'd1', server_time: SERVER_TIME });
  });

  it('rolls back the whole page (rows and cursor) when it fails', async () => {
    await catalogueRepository.replaceCatalogue(seedMenu(), position('c1', SERVER_TIME));

    await expect(
      catalogueRepository.applyDeltaPage(
        {
          categories: [],
          products: [syncProduct({ id: 1, category_id: 1, price_cents: 9900 }), syncProduct({ id: 8, category_id: 1, name: null as unknown as string })],
          deleted: { categories: [], products: [2] },
        },
        position('d1'),
      ),
    ).rejects.toThrow();

    expect(productIds()).toEqual([1, 2, 3, 4, 5]);
    const egg = currentTestDatabase().select().from(products).all().find((row) => row.id === 1);
    expect(egg?.price_cents).toBe(5000);
    expect(await catalogueRepository.readSyncState()).toMatchObject({ cursor: 'c1' });
  });

  it('lists the images of visible rows only (active categories and their products)', async () => {
    await catalogueRepository.replaceCatalogue(
      {
        categories: [
          syncCategory({ id: 1, image_url: `${ORIGIN}/storage/categories/1/a.webp`, image_path: 'categories/1/a.webp' }),
          syncCategory({ id: 2, is_active: false, image_url: `${ORIGIN}/storage/categories/2/b.webp`, image_path: 'categories/2/b.webp' }),
        ],
        products: [
          syncProduct({ id: 1, category_id: 1, is_available: false, image_url: `${ORIGIN}/storage/products/1/c.webp`, image_path: 'products/1/c.webp' }),
          syncProduct({ id: 2, category_id: 2, image_url: `${ORIGIN}/storage/products/2/d.webp`, image_path: 'products/2/d.webp' }),
          syncProduct({ id: 3, category_id: 404, image_url: `${ORIGIN}/storage/products/3/e.webp`, image_path: 'products/3/e.webp' }),
          syncProduct({ id: 4, category_id: 1 }),
        ],
      },
      position('c1', SERVER_TIME),
    );

    expect(await catalogueRepository.listVisibleImages()).toEqual([
      { url: `${ORIGIN}/storage/categories/1/a.webp`, path: 'categories/1/a.webp' },
      { url: `${ORIGIN}/storage/products/1/c.webp`, path: 'products/1/c.webp' },
    ]);
  });
});

describe('app wiring (GET /api/v1/sync/catalogue through the shared client)', () => {
  beforeEach(() => {
    secureStoreMock().__resetSecureStore();
    (router.replace as jest.Mock).mockClear();
  });

  it('first sync: a baseline without a cursor, stored in SQLite, status synced', async () => {
    const { calls } = routeFetch([
      { method: 'GET', path: '/api/v1/sync/catalogue', reply: () => mockResponse(200, syncPage(seedMenu())) },
    ]);

    const result = await requestCatalogueSync();

    expect(result).toMatchObject({ outcome: 'synced', mode: 'baseline' });
    expect(calls).toHaveLength(1);
    expect(calls[0].query.has('cursor')).toBe(false);
    expect(calls[0].query.get('limit')).toBe('500');
    expect(calls[0].init.headers).toMatchObject({ Accept: 'application/json' });
    expect(productIds()).toEqual([1, 2, 3, 4, 5]);
    expect(useSyncStore.getState()).toMatchObject({ status: 'synced', lastServerTime: SERVER_TIME });
  });

  it('a 401 signs out (Global Conventions) but keeps the local catalogue', async () => {
    await secureStoreMock().setItemAsync('pos.auth.token', 'expired-token');
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    await catalogueRepository.replaceCatalogue(seedMenu(), position('c1', SERVER_TIME));
    routeFetch([
      { method: 'GET', path: '/api/v1/sync/catalogue', reply: () => mockResponse(401, { message: 'Unauthenticated.' }) },
    ]);

    const result = await requestCatalogueSync();
    await flushTimers();

    expect(result).toMatchObject({ outcome: 'error' });
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(router.replace).toHaveBeenCalledWith('/login');
    expect(categoryIds()).toEqual([1, 2, 3]);
    expect(productIds()).toEqual([1, 2, 3, 4, 5]);
    expect(await catalogueRepository.readSyncState()).toMatchObject({ cursor: 'c1' });
  });

  it('a network error keeps the local catalogue and reports the message', async () => {
    await catalogueRepository.replaceCatalogue(seedMenu(), position('c1', SERVER_TIME));
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    const result = await requestCatalogueSync();

    expect(result).toMatchObject({ outcome: 'error' });
    expect(productIds()).toEqual([1, 2, 3, 4, 5]);
    expect(useSyncStore.getState().status).toBe('error');
    expect(useSyncStore.getState().error).toMatch(/Can't reach the server/);
  });
});
