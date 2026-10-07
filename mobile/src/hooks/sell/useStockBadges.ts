import { useEffect, useState } from 'react';

import { prepareDatabase } from '@/db/database';
import { offlineRepository, type CachedStockBadge } from '@/db/offlineRepository';
import type { MenuProduct } from '@/db/menuQueries';
import { useOfflineStore } from '@/stores/offline';

/**
 * The cached stock of the tiles' `track_stock` products, by product id
 * (docs/api-contract.md → Inventory → Sell tile badges), read from SQLite
 * `stock_cache`. Re-read whenever the cache changes (`stockVersion`: a
 * `/sync/stock` refresh or an offline sale). A product with no cached level
 * is missing (no badge). Badges never block a tap.
 */
export function useStockBadges(products: readonly MenuProduct[]): Map<number, CachedStockBadge> {
  const stockVersion = useOfflineStore((state) => state.stockVersion);
  const [badges, setBadges] = useState<Map<number, CachedStockBadge>>(() => new Map());
  const idsKey = products
    .filter((product) => product.track_stock)
    .map((product) => product.id)
    .join(',');

  useEffect(() => {
    // Badges are looked up by product id, so an older map is harmless when no tile tracks stock.
    if (idsKey === '') return;
    let active = true;
    void (async () => {
      try {
        if (!(await prepareDatabase())) return;
        const read = await offlineRepository.readStockBadges(idsKey.split(',').map(Number));
        if (active) setBadges(read);
      } catch {
        // No badge is better than a wrong one.
      }
    })();
    return () => {
      active = false;
    };
  }, [idsKey, stockVersion]);

  return badges;
}

/**
 * §J Sell badges: the tiles' recipe products whose cached status is `check`
 * (any component out), read from SQLite `recipe_status_cache` and re-read on
 * every cache change (`stockVersion`). Only products without `track_stock`
 * can be recipe products. The chip never blocks a tap.
 */
export function useRecipeChecks(products: readonly MenuProduct[]): ReadonlySet<number> {
  const stockVersion = useOfflineStore((state) => state.stockVersion);
  const [checks, setChecks] = useState<ReadonlySet<number>>(() => new Set());
  const idsKey = products
    .filter((product) => !product.track_stock)
    .map((product) => product.id)
    .join(',');

  useEffect(() => {
    if (idsKey === '') return;
    let active = true;
    void (async () => {
      try {
        if (!(await prepareDatabase())) return;
        const read = await offlineRepository.readRecipeChecks(idsKey.split(',').map(Number));
        if (active) setChecks(read);
      } catch {
        // No chip is better than a wrong one.
      }
    })();
    return () => {
      active = false;
    };
  }, [idsKey, stockVersion]);

  return checks;
}
