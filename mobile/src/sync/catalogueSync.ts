/**
 * Catalogue sync: pulls `GET /api/v1/sync/catalogue` into on-device SQLite
 * (docs/api-contract.md → Catalogue Sync (Phase 2) → Device rules).
 *
 * - **Baseline vs delta.** A run starts without a cursor (a baseline) when no
 *   cursor is stored, or when the stored cursor belongs to another API origin
 *   (`EXPO_PUBLIC_API_URL`), so two servers' data never mix. A schema
 *   migration asks for a baseline by clearing the stored cursor. Otherwise it
 *   sends the stored cursor (a delta). Each run is applied according to the
 *   first page's `meta.full`.
 * - **Baseline apply:** every page is collected in memory, then both tables are
 *   replaced and the cursor saved in **one** transaction after the last page.
 *   A baseline that fails partway leaves the old menu in place.
 * - **Delta apply:** one transaction per page: upsert, delete the tombstones,
 *   save that page's `next_cursor`. Continue while `has_more`.
 * - **422 on `cursor`:** start a baseline straight away, once per run.
 * - **401:** the shared client signs out; the local catalogue is kept.
 * - **Offline** (expo-network): skip the request; status `offline`. A network
 *   error never clears the local menu.
 * - **One run at a time:** a trigger during a run joins it (same promise), not queued.
 * - **Images:** after a successful run, the images of every visible row are
 *   prefetched into the expo-image disk cache; failures are ignored.
 *
 * `runCatalogueSync` is pure apart from its `deps`, so the apply logic is unit
 * tested with a mocked repository and fetcher. `requestCatalogueSync` is the
 * app entry point used by every trigger.
 */
import { Image } from 'expo-image';
import * as Network from 'expo-network';

import { catalogueRepository, type CatalogueRepository, type VisibleImage } from '@/db/catalogueRepository';
import { DATABASE_ERROR_MESSAGE, prepareDatabase } from '@/db/database';
import { API_BASE_URL, getErrorMessage, isApiValidationError } from '@/services/api';
import { getCatalogueChanges } from '@/services/sync';
import type {
  CatalogueSyncParams,
  CatalogueSyncResponse,
  SyncCategory,
  SyncProduct,
} from '@/services/types';
import { useSyncStore } from '@/stores/sync';

/** Rows per entity per page: the contract's maximum (and default). */
export const SYNC_PAGE_LIMIT = 500;

/** Foreground sync interval (contract: "every 5 minutes while in the foreground and online"). */
export const FOREGROUND_SYNC_INTERVAL_MS = 5 * 60_000;

/** The on-device database could not be opened or migrated (see `prepareDatabase`). */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super('The on-device database is unavailable.');
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'DatabaseUnavailableError';
  }
}

export type CatalogueSyncDeps = {
  repository: CatalogueRepository;
  fetchPage: (params: CatalogueSyncParams) => Promise<CatalogueSyncResponse>;
  /** `false` only when the device reports no network connection. */
  isOnline: () => Promise<boolean>;
  /** The configured API origin (`EXPO_PUBLIC_API_URL`), saved with the cursor. */
  apiOrigin: string;
  prefetchImages: (images: VisibleImage[]) => Promise<unknown>;
  /** Opens / migrates the database; `false` when it can't be used. */
  prepareDatabase: () => Promise<boolean>;
  pageLimit?: number;
};

export type SyncMode = 'baseline' | 'delta';

export type CatalogueSyncResult =
  | { outcome: 'synced'; mode: SyncMode; serverTime: string; changed: boolean }
  | { outcome: 'offline'; changed: false }
  | { outcome: 'error'; error: unknown; changed: boolean };

/** A 422 whose `errors` name the cursor ("The sync cursor is invalid. Start a full sync."). */
export function isInvalidCursorError(error: unknown): boolean {
  return isApiValidationError(error) && error.errors.cursor !== undefined;
}

type Progress = { changed: boolean };

type RunSummary = { mode: SyncMode; serverTime: string };

/** Fetches every page of a baseline run (starting from `first`), then replaces the catalogue in one transaction. */
async function applyBaseline(
  deps: CatalogueSyncDeps,
  first: CatalogueSyncResponse,
  limit: number,
  progress: Progress,
): Promise<RunSummary> {
  // Keyed by id: a row that moves between pages mid-run keeps its newest copy.
  const categoryById = new Map<number, SyncCategory>();
  const productById = new Map<number, SyncProduct>();

  let page = first;
  for (;;) {
    for (const category of page.data.categories) categoryById.set(category.id, category);
    for (const product of page.data.products) productById.set(product.id, product);
    // Always empty in a baseline; honoured anyway so a deleted row can never survive.
    for (const id of page.data.deleted.categories) categoryById.delete(id);
    for (const id of page.data.deleted.products) productById.delete(id);

    if (!page.meta.has_more) break;
    page = await deps.fetchPage({ cursor: page.meta.next_cursor, limit });
  }

  await deps.repository.replaceCatalogue(
    { categories: [...categoryById.values()], products: [...productById.values()] },
    { cursor: page.meta.next_cursor, apiOrigin: deps.apiOrigin, serverTime: page.meta.server_time },
  );
  progress.changed = true;
  return { mode: 'baseline', serverTime: page.meta.server_time };
}

/** Applies a delta run page by page (starting from `first`): one transaction per page, cursor included. */
async function applyDelta(
  deps: CatalogueSyncDeps,
  first: CatalogueSyncResponse,
  limit: number,
  progress: Progress,
): Promise<RunSummary> {
  let page = first;
  for (;;) {
    const last = !page.meta.has_more;
    await deps.repository.applyDeltaPage(page.data, {
      cursor: page.meta.next_cursor,
      apiOrigin: deps.apiOrigin,
      // "Synced at" moves only when the run completes.
      serverTime: last ? page.meta.server_time : undefined,
    });
    progress.changed = true;
    if (last) return { mode: 'delta', serverTime: page.meta.server_time };
    page = await deps.fetchPage({ cursor: page.meta.next_cursor, limit });
  }
}

/** One run from `cursor` (`undefined` = baseline). */
async function pull(deps: CatalogueSyncDeps, cursor: string | undefined, progress: Progress): Promise<RunSummary> {
  const limit = deps.pageLimit ?? SYNC_PAGE_LIMIT;
  const first = await deps.fetchPage(cursor === undefined ? { limit } : { cursor, limit });
  return first.meta.full ? applyBaseline(deps, first, limit, progress) : applyDelta(deps, first, limit, progress);
}

/** Prefetches the visible images. Never throws, and never delays the result. */
async function prefetchVisibleImages(deps: CatalogueSyncDeps): Promise<void> {
  try {
    const images = await deps.repository.listVisibleImages();
    if (images.length > 0) await deps.prefetchImages(images);
  } catch {
    // A failed prefetch is ignored: the tile falls back to loading (or its placeholder).
  }
}

/** One full sync attempt. Never throws: the outcome says what happened. */
export async function runCatalogueSync(deps: CatalogueSyncDeps): Promise<CatalogueSyncResult> {
  const progress: Progress = { changed: false };

  try {
    if (!(await deps.prepareDatabase())) {
      return { outcome: 'error', error: new DatabaseUnavailableError(), changed: false };
    }
    if (!(await deps.isOnline())) return { outcome: 'offline', changed: false };

    const state = await deps.repository.readSyncState();
    const canResume = Boolean(state?.cursor) && state?.api_origin === deps.apiOrigin;
    let cursor = canResume ? (state?.cursor ?? undefined) : undefined;
    let rebaselined = false;

    for (;;) {
      try {
        const summary = await pull(deps, cursor, progress);
        void prefetchVisibleImages(deps);
        return { outcome: 'synced', ...summary, changed: progress.changed };
      } catch (error) {
        if (rebaselined || !isInvalidCursorError(error)) throw error;
        // The server rejected the cursor: start one fresh baseline in this run.
        rebaselined = true;
        cursor = undefined;
      }
    }
  } catch (error) {
    return { outcome: 'error', error, changed: progress.changed };
  }
}

/** The message shown for a failed run. */
export function syncErrorMessage(error: unknown): string {
  if (error instanceof DatabaseUnavailableError) {
    return useSyncStore.getState().databaseError ?? DATABASE_ERROR_MESSAGE;
  }
  return getErrorMessage(error);
}

/**
 * Wraps `runCatalogueSync` for the app: one run at a time (a trigger during a
 * run gets the same promise), and the result is written to the sync store.
 */
export function createCatalogueSyncRunner(getDeps: () => CatalogueSyncDeps) {
  let inFlight: Promise<CatalogueSyncResult> | null = null;

  async function run(): Promise<CatalogueSyncResult> {
    const store = useSyncStore.getState();
    store.startSync();
    const result = await runCatalogueSync(getDeps());

    if (result.changed) store.markCatalogueChanged();
    if (result.outcome === 'synced') store.setSynced(result.serverTime);
    else if (result.outcome === 'offline') store.setOffline();
    else store.setError(syncErrorMessage(result.error));
    return result;
  }

  return function request(): Promise<CatalogueSyncResult> {
    if (inFlight) return inFlight;
    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

// ---------------------------------------------------------------------------
// App wiring
// ---------------------------------------------------------------------------

/** Offline only when the device reports no connection (a LAN-only server has no "internet"). */
export async function isDeviceOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected !== false;
  } catch {
    // Unknown: let the request decide.
    return true;
  }
}

/**
 * Prefetches into expo-image's **disk** cache.
 * Keyed by URL (Q-002, resolved): `Image.prefetch` (SDK 57) has no cache-key
 * option, so tiles load by URL too and hit this prefetch. This relies on
 * `image_url` being stable; presigned URLs would need `cacheKey: image_path`.
 */
async function prefetchIntoDiskCache(images: VisibleImage[]): Promise<boolean> {
  const urls = [...new Set(images.map((image) => image.url))];
  return Image.prefetch(urls, 'disk');
}

function appDeps(): CatalogueSyncDeps {
  return {
    repository: catalogueRepository,
    fetchPage: getCatalogueChanges,
    isOnline: isDeviceOnline,
    apiOrigin: API_BASE_URL,
    prefetchImages: prefetchIntoDiskCache,
    prepareDatabase,
  };
}

/**
 * Starts a catalogue sync, or joins the one already running. Every trigger
 * calls this: login / session restore, foreground, the 5-minute timer,
 * "Sync now", and successful admin catalogue changes. Never rejects.
 */
export const requestCatalogueSync = createCatalogueSyncRunner(appDeps);
