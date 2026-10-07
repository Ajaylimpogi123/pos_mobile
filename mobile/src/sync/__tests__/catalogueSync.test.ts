/**
 * Catalogue sync run loop and apply logic (docs/api-contract.md → Catalogue
 * Sync → Device rules), with a mocked repository and fetcher.
 * The SQLite side of the same rules is covered in catalogueRepository.test.ts.
 */
import type { CatalogueRepository } from '@/db/catalogueRepository';
import type { SyncStateRow } from '@/db/schema';
import { ApiError, ApiValidationError } from '@/services/api';
import type { CatalogueSyncParams, CatalogueSyncResponse } from '@/services/types';
import { useSyncStore } from '@/stores/sync';
import {
  createCatalogueSyncRunner,
  runCatalogueSync,
  SYNC_PAGE_LIMIT,
  type CatalogueSyncDeps,
} from '@/sync/catalogueSync';
import { deferred } from '@/test-utils/catalog';
import { SERVER_TIME, syncCategory, syncPage, syncProduct } from '@/test-utils/sync';

const ORIGIN = 'http://192.168.1.50:8000';
const INVALID_CURSOR = 'The sync cursor is invalid. Start a full sync.';

function mockRepository(state: SyncStateRow | null = null) {
  return {
    readSyncState: jest.fn(async () => state),
    replaceCatalogue: jest.fn(async () => undefined),
    applyDeltaPage: jest.fn(async () => undefined),
    listVisibleImages: jest.fn(async () => [{ url: `${ORIGIN}/storage/products/7/a.webp`, path: 'products/7/a.webp' }]),
  } satisfies CatalogueRepository;
}

function makeDeps(
  pages: (CatalogueSyncResponse | Error)[],
  overrides: Partial<CatalogueSyncDeps> = {},
): CatalogueSyncDeps & { fetchPage: jest.Mock; repository: ReturnType<typeof mockRepository> } {
  const queue = [...pages];
  const fetchPage = jest.fn(async (_params: CatalogueSyncParams) => {
    const next = queue.shift();
    if (!next) throw new Error('No more pages queued');
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    repository: mockRepository(),
    fetchPage,
    isOnline: jest.fn(async () => true),
    apiOrigin: ORIGIN,
    prefetchImages: jest.fn(async () => true),
    prepareDatabase: jest.fn(async () => true),
    ...overrides,
  } as CatalogueSyncDeps & { fetchPage: jest.Mock; repository: ReturnType<typeof mockRepository> };
}

const stored = (cursor: string | null, apiOrigin: string | null = ORIGIN): SyncStateRow => ({
  scope: 'catalogue',
  cursor,
  api_origin: apiOrigin,
  server_time: '2026-09-24T00:00:00Z',
});

beforeEach(() => {
  useSyncStore.getState().reset();
});

describe('baseline', () => {
  it('runs a baseline when no cursor is stored: collects every page, then replaces once with the last cursor', async () => {
    const deps = makeDeps([
      syncPage({
        categories: [syncCategory({ id: 1 })],
        products: [syncProduct({ id: 1, category_id: 1, name: 'Old name' })],
        meta: { has_more: true, next_cursor: 'c1', server_time: '2026-09-24T01:05:00Z' },
      }),
      syncPage({
        categories: [syncCategory({ id: 2 })],
        // The same product again on a later page: its newest copy wins.
        products: [syncProduct({ id: 1, category_id: 1, name: 'New name' }), syncProduct({ id: 2, category_id: 2 })],
        meta: { has_more: false, next_cursor: 'c2', server_time: SERVER_TIME },
      }),
    ]);

    const result = await runCatalogueSync(deps);

    expect(deps.fetchPage.mock.calls.map(([params]) => params)).toEqual([
      { limit: SYNC_PAGE_LIMIT },
      { cursor: 'c1', limit: SYNC_PAGE_LIMIT },
    ]);
    expect(deps.repository.applyDeltaPage).not.toHaveBeenCalled();
    expect(deps.repository.replaceCatalogue).toHaveBeenCalledTimes(1);
    const [snapshot, position] = deps.repository.replaceCatalogue.mock.calls[0] as unknown as Parameters<
      CatalogueRepository['replaceCatalogue']
    >;
    expect(snapshot.categories.map((category) => category.id)).toEqual([1, 2]);
    expect(snapshot.products.map((product) => [product.id, product.name])).toEqual([
      [1, 'New name'],
      [2, 'Product 2'],
    ]);
    expect(position).toEqual({ cursor: 'c2', apiOrigin: ORIGIN, serverTime: SERVER_TIME });
    expect(result).toEqual({ outcome: 'synced', mode: 'baseline', serverTime: SERVER_TIME, changed: true });
  });

  it('a baseline that fails partway writes nothing, so the old menu stays', async () => {
    const deps = makeDeps([
      syncPage({ categories: [syncCategory({ id: 1 })], meta: { has_more: true, next_cursor: 'c1' } }),
      new ApiError('The server had a problem. Please try again.', { status: 500, kind: 'http' }),
    ]);

    const result = await runCatalogueSync(deps);

    expect(deps.repository.replaceCatalogue).not.toHaveBeenCalled();
    expect(deps.repository.applyDeltaPage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: 'error', changed: false });
  });

  it('starts a baseline when the API origin differs from the one saved with the cursor', async () => {
    const deps = makeDeps([syncPage()], { repository: mockRepository(stored('old-cursor', 'http://10.0.0.9:8000')) });

    await runCatalogueSync(deps);

    expect(deps.fetchPage).toHaveBeenCalledWith({ limit: SYNC_PAGE_LIMIT });
    expect(deps.repository.replaceCatalogue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiOrigin: ORIGIN }));
  });

  it('starts a baseline when a migration cleared the cursor', async () => {
    const deps = makeDeps([syncPage()], { repository: mockRepository(stored(null)) });

    await runCatalogueSync(deps);

    expect(deps.fetchPage).toHaveBeenCalledWith({ limit: SYNC_PAGE_LIMIT });
  });
});

describe('delta', () => {
  it('sends the stored cursor and applies each page with its own cursor; "synced at" moves on the last page only', async () => {
    const first = syncPage({
      products: [syncProduct({ id: 7, category_id: 2, price_cents: 5500 })],
      deleted: { products: [12, 13] },
      meta: { full: false, has_more: true, next_cursor: 'd1', server_time: '2026-09-24T01:05:00Z' },
    });
    const last = syncPage({
      categories: [syncCategory({ id: 2 })],
      deleted: { categories: [5] },
      meta: { full: false, has_more: false, next_cursor: 'd2', server_time: SERVER_TIME },
    });
    const deps = makeDeps([first, last], { repository: mockRepository(stored('stored-cursor')) });

    const result = await runCatalogueSync(deps);

    expect(deps.fetchPage.mock.calls.map(([params]) => params)).toEqual([
      { cursor: 'stored-cursor', limit: SYNC_PAGE_LIMIT },
      { cursor: 'd1', limit: SYNC_PAGE_LIMIT },
    ]);
    expect(deps.repository.replaceCatalogue).not.toHaveBeenCalled();
    expect(deps.repository.applyDeltaPage.mock.calls).toEqual([
      [first.data, { cursor: 'd1', apiOrigin: ORIGIN, serverTime: undefined }],
      [last.data, { cursor: 'd2', apiOrigin: ORIGIN, serverTime: SERVER_TIME }],
    ]);
    expect(result).toEqual({ outcome: 'synced', mode: 'delta', serverTime: SERVER_TIME, changed: true });
  });

  it('keeps the pages already applied when a later page fails', async () => {
    const deps = makeDeps(
      [
        syncPage({ meta: { full: false, has_more: true, next_cursor: 'd1' } }),
        new ApiError("Can't reach the server.", { status: null, kind: 'network' }),
      ],
      { repository: mockRepository(stored('stored-cursor')) },
    );

    const result = await runCatalogueSync(deps);

    expect(deps.repository.applyDeltaPage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'error', changed: true });
  });
});

describe('422 on the cursor', () => {
  it('starts one fresh baseline in the same run', async () => {
    const deps = makeDeps(
      [new ApiValidationError(INVALID_CURSOR, { cursor: [INVALID_CURSOR] }), syncPage({ categories: [syncCategory({ id: 1 })] })],
      { repository: mockRepository(stored('bad-cursor')) },
    );

    const result = await runCatalogueSync(deps);

    expect(deps.fetchPage.mock.calls.map(([params]) => params)).toEqual([
      { cursor: 'bad-cursor', limit: SYNC_PAGE_LIMIT },
      { limit: SYNC_PAGE_LIMIT },
    ]);
    expect(deps.repository.replaceCatalogue).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'synced', mode: 'baseline' });
  });

  it('re-baselines only once per run, so it cannot loop', async () => {
    const invalid = () => new ApiValidationError(INVALID_CURSOR, { cursor: [INVALID_CURSOR] });
    const deps = makeDeps(
      [invalid(), syncPage({ meta: { has_more: true, next_cursor: 'c1' } }), invalid(), syncPage()],
      { repository: mockRepository(stored('bad-cursor')) },
    );

    const result = await runCatalogueSync(deps);

    expect(deps.fetchPage).toHaveBeenCalledTimes(3);
    expect(deps.repository.replaceCatalogue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: 'error' });
  });

  it('does not re-baseline for a 422 that is not about the cursor', async () => {
    const deps = makeDeps([new ApiValidationError('The limit field must not be greater than 500.', { limit: ['…'] })], {
      repository: mockRepository(stored('cursor')),
    });

    const result = await runCatalogueSync(deps);

    expect(deps.fetchPage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'error' });
  });
});

describe('offline, database and images', () => {
  it('skips the request when the device is offline', async () => {
    const deps = makeDeps([], { isOnline: jest.fn(async () => false) });

    const result = await runCatalogueSync(deps);

    expect(deps.fetchPage).not.toHaveBeenCalled();
    expect(deps.repository.readSyncState).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'offline', changed: false });
  });

  it('reports an error without calling the server when the database is unavailable', async () => {
    const deps = makeDeps([], { prepareDatabase: jest.fn(async () => false) });

    const result = await runCatalogueSync(deps);

    expect(deps.fetchPage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: 'error', changed: false });
  });

  it('prefetches the visible images after a successful run, and ignores a failed prefetch', async () => {
    const deps = makeDeps([syncPage()], { prefetchImages: jest.fn(async () => Promise.reject(new Error('404'))) });

    const result = await runCatalogueSync(deps);
    await Promise.resolve();
    await Promise.resolve();

    expect(result.outcome).toBe('synced');
    expect(deps.prefetchImages).toHaveBeenCalledWith([
      { url: `${ORIGIN}/storage/products/7/a.webp`, path: 'products/7/a.webp' },
    ]);
  });
});

describe('runner (one at a time) and status', () => {
  it('merges a trigger during a run into it instead of queueing another run', async () => {
    const held = deferred<CatalogueSyncResponse>();
    const deps = makeDeps([]);
    deps.fetchPage.mockImplementationOnce(() => held.promise);
    const request = createCatalogueSyncRunner(() => deps);

    const first = request();
    const second = request();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(useSyncStore.getState().status).toBe('syncing');

    held.resolve(syncPage());
    await first;
    expect(deps.fetchPage).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState()).toMatchObject({ status: 'synced', lastServerTime: SERVER_TIME, catalogueVersion: 1 });

    // Once finished, the next trigger starts a new run.
    deps.fetchPage.mockResolvedValueOnce(syncPage({ meta: { full: false } }));
    await request();
    expect(deps.fetchPage).toHaveBeenCalledTimes(2);
  });

  it('sets offline and error statuses without touching the menu version', async () => {
    const offline = createCatalogueSyncRunner(() => makeDeps([], { isOnline: jest.fn(async () => false) }));
    await offline();
    expect(useSyncStore.getState()).toMatchObject({ status: 'offline', catalogueVersion: 0 });

    const failing = createCatalogueSyncRunner(() =>
      makeDeps([new ApiError('The server had a problem. Please try again.', { status: 500, kind: 'http' })]),
    );
    await failing();
    expect(useSyncStore.getState()).toMatchObject({
      status: 'error',
      error: 'The server had a problem. Please try again.',
      catalogueVersion: 0,
    });
  });
});
