import { useEffect, useMemo, useState } from 'react';

import { prepareDatabase } from '@/db/database';
import { offlineRepository } from '@/db/offlineRepository';
import { useCanReachServer } from '@/hooks/useIsOnline';
import { stockDemand } from '@/sale/offlineSale';
import type { CartLine } from '@/stores/cart';
import { useOfflineStore } from '@/stores/offline';

/** Contract wording: `Only 2 left (offline estimate)`. */
export function offlineStockMessage(qty: number): string {
  return `Only ${Math.max(0, qty)} left (offline estimate)`;
}

/**
 * Offline stock warnings (docs/api-contract.md → Offline Sales → Offline
 * stock), by cart line key: while the device is offline, a line of a
 * `track_stock` product whose cart quantity (summed over its lines, as the
 * server counts it) exceeds the cached level shows `Only 2 left (offline
 * estimate)`. A warning only: stock never blocks an offline sale. Products
 * with no cached level show nothing. Online, the server checks stock itself.
 */
export function useStockWarnings(lines: readonly CartLine[]): Record<string, string> {
  const online = useCanReachServer();
  const stockVersion = useOfflineStore((state) => state.stockVersion);
  const [levels, setLevels] = useState<Map<number, number>>(() => new Map());

  const demand = useMemo(() => stockDemand(lines), [lines]);
  const idsKey = demand.map((entry) => entry.product_id).join(',');

  useEffect(() => {
    if (online || idsKey === '') return;
    let active = true;
    void (async () => {
      try {
        if (!(await prepareDatabase())) return;
        const read = await offlineRepository.readStockLevels(idsKey.split(',').map(Number));
        if (active) setLevels(read);
      } catch {
        // No warning is better than a wrong one.
      }
    })();
    return () => {
      active = false;
    };
  }, [online, idsKey, stockVersion]);

  return useMemo(() => {
    const warnings: Record<string, string> = {};
    if (online) return warnings;
    for (const entry of demand) {
      const cached = levels.get(entry.product_id);
      if (cached === undefined || entry.qty <= cached) continue;
      for (const line of lines) {
        if (line.product.id === entry.product_id) warnings[line.key] = offlineStockMessage(cached);
      }
    }
    return warnings;
  }, [online, demand, levels, lines]);
}
