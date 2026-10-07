/**
 * The advisory stock cache (docs/api-contract.md → Offline Sales → Offline
 * stock): `GET /api/v1/sync/stock` into SQLite `stock_cache`, replaced in one
 * transaction. Offline sales lower it (in their own transaction), and the
 * cart warns `Only 2 left (offline estimate)` from it. Stock **never** blocks
 * an offline sale.
 *
 * Refreshed on the catalogue-sync triggers (login and restore, foreground,
 * the 5-minute timer, "Sync now") and after each online sale. Offline, or on
 * any failure, the cache is kept. One run at a time (a trigger joins it).
 */
import { prepareDatabase } from '@/db/database';
import { offlineRepository, type OfflineRepository } from '@/db/offlineRepository';
import { getStockLevels } from '@/services/sync';
import type { StockSnapshot } from '@/services/types';
import { useOfflineStore } from '@/stores/offline';
import { useSessionStore } from '@/stores/session';
import { isDeviceOnline } from '@/sync/catalogueSync';

export type StockSyncDeps = {
  fetchLevels: () => Promise<StockSnapshot>;
  repository: Pick<OfflineRepository, 'replaceStockCache'>;
  isOnline: () => Promise<boolean>;
  isSignedIn: () => boolean;
  prepareDatabase: () => Promise<boolean>;
};

export type StockSyncResult = { outcome: 'synced'; serverTime: string } | { outcome: 'skipped' } | { outcome: 'error'; error: unknown };

/** One refresh. Never throws; a failure keeps the cache as it is. */
export async function runStockSync(deps: StockSyncDeps): Promise<StockSyncResult> {
  try {
    if (!(await deps.prepareDatabase())) return { outcome: 'skipped' };
    if (!deps.isSignedIn() || !(await deps.isOnline())) return { outcome: 'skipped' };
    const snapshot = await deps.fetchLevels();
    const levels = Array.isArray(snapshot.levels) ? snapshot.levels : [];
    await deps.repository.replaceStockCache(
      levels
        .filter((level) => Number.isSafeInteger(level.product_id) && Number.isSafeInteger(level.qty))
        // Inventory (v1 completion): `reorder_level` (integer or null) drives the Sell tiles' Low badge.
        .map((level) => ({
          product_id: level.product_id,
          qty: level.qty,
          reorder_level: Number.isSafeInteger(level.reorder_level) ? level.reorder_level : null,
        })),
      snapshot.server_time,
      // §J: the recipe products' `ok` / `check` (drives the Sell tiles' `Check stock` chip).
      (Array.isArray(snapshot.recipes) ? snapshot.recipes : []).filter(
        (recipe) => Number.isSafeInteger(recipe.product_id) && (recipe.status === 'ok' || recipe.status === 'check'),
      ),
    );
    return { outcome: 'synced', serverTime: snapshot.server_time };
  } catch (error) {
    return { outcome: 'error', error };
  }
}

export function createStockSyncRunner(getDeps: () => StockSyncDeps) {
  let inFlight: Promise<StockSyncResult> | null = null;
  return function request(): Promise<StockSyncResult> {
    if (inFlight) return inFlight;
    inFlight = runStockSync(getDeps())
      .then((result) => {
        if (result.outcome === 'synced') useOfflineStore.getState().markStockChanged();
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

function appDeps(): StockSyncDeps {
  return {
    fetchLevels: getStockLevels,
    repository: offlineRepository,
    isOnline: isDeviceOnline,
    isSignedIn: () => useSessionStore.getState().status === 'signedIn',
    prepareDatabase,
  };
}

/** Refreshes the stock cache, or joins the refresh in progress. Never rejects. */
export const requestStockSync = createStockSyncRunner(appDeps);
