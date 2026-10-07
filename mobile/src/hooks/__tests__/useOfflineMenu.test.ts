/**
 * useOfflineMenu: the contract's Device visibility rules, ordering and search,
 * run against the app's real schema and queries on an in-memory SQLite engine
 * (src/test-utils/database.ts).
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { catalogueRepository } from '@/db/catalogueRepository';
import { containsPattern, escapeLike } from '@/db/menuQueries';
import { useOfflineMenu, type OfflineMenuFilter } from '@/hooks/useOfflineMenu';
import { useSyncStore } from '@/stores/sync';
import { freshTestDatabase } from '@/test-utils/database';
import { SERVER_TIME, syncCategory, syncProduct } from '@/test-utils/sync';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const ALL: OfflineMenuFilter = { categoryId: null, search: '' };

async function store(categories: ReturnType<typeof syncCategory>[], products: ReturnType<typeof syncProduct>[]) {
  await catalogueRepository.replaceCatalogue(
    { categories, products },
    { cursor: 'c1', apiOrigin: 'http://192.168.1.50:8000', serverTime: SERVER_TIME },
  );
}

async function renderMenu(filter: OfflineMenuFilter = ALL) {
  const hook = await renderHook((props: OfflineMenuFilter) => useOfflineMenu(props), { initialProps: filter });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(async () => {
  await freshTestDatabase();
  useSyncStore.getState().reset();
});

describe('before the first sync', () => {
  it('reports no data (the "Menu not synced yet" state)', async () => {
    const { result } = await renderMenu();

    expect(result.current).toMatchObject({ hasData: false, serverTime: null, categories: [], products: [], error: null });
  });
});

describe('categories', () => {
  it('shows active categories only, ordered by sort_order, then name (case-insensitive), then id', async () => {
    await store(
      [
        syncCategory({ id: 1, name: 'drinks', sort_order: 20 }),
        syncCategory({ id: 2, name: 'Breakfast', sort_order: 10 }),
        syncCategory({ id: 3, name: 'Archived', sort_order: 0, is_active: false }),
        syncCategory({ id: 4, name: 'Desserts', sort_order: 20 }),
        syncCategory({ id: 6, name: 'Specials', sort_order: 30 }),
        syncCategory({ id: 5, name: 'specials', sort_order: 30 }),
      ],
      [],
    );

    const { result } = await renderMenu();

    expect(result.current.categories.map((category) => [category.id, category.name])).toEqual([
      [2, 'Breakfast'],
      [4, 'Desserts'],
      [1, 'drinks'],
      [5, 'specials'],
      [6, 'Specials'],
    ]);
    expect(result.current).toMatchObject({ hasData: true, serverTime: SERVER_TIME });
  });

  it('counts only available products per category', async () => {
    await store(
      [syncCategory({ id: 1 }), syncCategory({ id: 2 })],
      [
        syncProduct({ id: 1, category_id: 1 }),
        syncProduct({ id: 2, category_id: 1 }),
        syncProduct({ id: 3, category_id: 1, is_available: false }),
        syncProduct({ id: 4, category_id: 2, is_available: false }),
      ],
    );

    const { result } = await renderMenu();

    expect(result.current.categories.map((category) => [category.id, category.products_count])).toEqual([
      [1, 2],
      [2, 0],
    ]);
  });
});

describe('products', () => {
  it('hides products whose category is inactive or not stored locally, and keeps unavailable ones', async () => {
    await store(
      [syncCategory({ id: 1 }), syncCategory({ id: 2, is_active: false })],
      [
        syncProduct({ id: 1, category_id: 1 }),
        syncProduct({ id: 2, category_id: 1, is_available: false }),
        syncProduct({ id: 3, category_id: 2 }),
        syncProduct({ id: 4, category_id: 404 }),
      ],
    );

    const { result } = await renderMenu();

    expect(result.current.products.map((product) => [product.id, product.is_available])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('orders by sort_order, then name (case-insensitive), then id', async () => {
    await store(
      [syncCategory({ id: 1 })],
      [
        syncProduct({ id: 1, category_id: 1, name: 'Zesty Wings', sort_order: 0 }),
        syncProduct({ id: 2, category_id: 1, name: 'apple Pie', sort_order: 5 }),
        syncProduct({ id: 3, category_id: 1, name: 'Banana Split', sort_order: 5 }),
        syncProduct({ id: 5, category_id: 1, name: 'Cake', sort_order: 5 }),
        syncProduct({ id: 4, category_id: 1, name: 'cake', sort_order: 5 }),
      ],
    );

    const { result } = await renderMenu();

    expect(result.current.products.map((product) => product.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('filters by category and searches name or SKU case-insensitively; re-reads when the filter changes', async () => {
    await store(
      [syncCategory({ id: 1 }), syncCategory({ id: 2 })],
      [
        syncProduct({ id: 1, category_id: 1, name: 'Egg with Rice', sku: 'BRK-001' }),
        syncProduct({ id: 2, category_id: 1, name: 'Hot Dog', sku: 'BRK-002' }),
        syncProduct({ id: 3, category_id: 2, name: 'Iced Tea', sku: 'DRK-001' }),
      ],
    );
    const { result, rerender } = await renderMenu();

    await act(async () => rerender({ categoryId: 2, search: '' }));
    await waitFor(() => expect(result.current.products.map((product) => product.id)).toEqual([3]));

    await act(async () => rerender({ categoryId: null, search: '  brk-00 ' }));
    await waitFor(() => expect(result.current.products.map((product) => product.id)).toEqual([1, 2]));

    await act(async () => rerender({ categoryId: null, search: 'RICE' }));
    await waitFor(() => expect(result.current.products.map((product) => product.id)).toEqual([1]));

    await act(async () => rerender({ categoryId: 2, search: 'rice' }));
    await waitFor(() => expect(result.current.products).toEqual([]));
  });

  it('treats %, _ and \\ in the search literally', async () => {
    await store(
      [syncCategory({ id: 1 })],
      [
        syncProduct({ id: 1, category_id: 1, name: '100% Mango' }),
        syncProduct({ id: 2, category_id: 1, name: '1000 Island' }),
        syncProduct({ id: 3, category_id: 1, name: 'Plain', sku: 'SET_A' }),
        syncProduct({ id: 4, category_id: 1, name: 'Plain', sku: 'SETXA' }),
        syncProduct({ id: 5, category_id: 1, name: 'Back\\slash' }),
      ],
    );
    const { result, rerender } = await renderMenu();

    await act(async () => rerender({ categoryId: null, search: '0%' }));
    await waitFor(() => expect(result.current.products.map((product) => product.id)).toEqual([1]));

    await act(async () => rerender({ categoryId: null, search: 'set_' }));
    await waitFor(() => expect(result.current.products.map((product) => product.id)).toEqual([3]));

    await act(async () => rerender({ categoryId: null, search: 'k\\s' }));
    await waitFor(() => expect(result.current.products.map((product) => product.id)).toEqual([5]));

    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(containsPattern('a_b')).toBe('%a\\_b%');
  });

  it('re-reads after a sync commits (catalogueVersion) and keeps the old rows on screen meanwhile', async () => {
    await store([syncCategory({ id: 1 })], [syncProduct({ id: 1, category_id: 1 })]);
    const { result } = await renderMenu();
    expect(result.current.products.map((product) => product.id)).toEqual([1]);

    await catalogueRepository.applyDeltaPage(
      { categories: [], products: [syncProduct({ id: 2, category_id: 1 })], deleted: { categories: [], products: [1] } },
      { cursor: 'd1', apiOrigin: 'http://192.168.1.50:8000' },
    );
    expect(result.current.products.map((product) => product.id)).toEqual([1]);

    await act(async () => useSyncStore.getState().markCatalogueChanged());
    await waitFor(() => expect(result.current.products.map((product) => product.id)).toEqual([2]));
    expect(result.current.loading).toBe(false);
  });
});
