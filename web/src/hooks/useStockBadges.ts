/**
 * Sell stock badges (Inventory → Sell tile badges, §J; Q-036), as on the
 * tablet: `GET /sync/stock` read when Sell opens, after each completed sale
 * (the checkout invalidates `stockKey`) and every 5 minutes.
 * - a `track_stock` product: **Out of stock** when `qty ≤ 0`, **Low stock**
 *   when `qty ≤ reorder_level`; no level → no badge;
 * - a recipe product with status `check`: **Check stock**.
 * Badges are advisory: they never block adding (the server's stock 422 still
 * blocks an online sale).
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getStockSnapshot } from '@/services/stock';

export const stockKey = ['stock'] as const;

export type StockBadge = { kind: 'out' | 'low' | 'check'; label: string; qty: number | null };

/** The tablet's rule (`stockBadge` in `mobile/src/components/inventory/inventoryLabels.ts`). */
export function stockBadgeFor(qty: number, reorderLevel: number | null): StockBadge | null {
  if (qty <= 0) return { kind: 'out', label: 'Out of stock', qty };
  if (reorderLevel !== null && qty <= reorderLevel) return { kind: 'low', label: `Low stock · ${qty} left`, qty };
  return null;
}

export function useStockBadges(): Map<number, StockBadge> {
  const query = useQuery({
    queryKey: stockKey,
    queryFn: getStockSnapshot,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 5 * 60_000,
  });
  return useMemo(() => {
    const badges = new Map<number, StockBadge>();
    if (!query.data) return badges;
    for (const level of query.data.levels) {
      const badge = stockBadgeFor(level.qty, level.reorder_level);
      if (badge) badges.set(level.product_id, badge);
    }
    for (const recipe of query.data.recipes ?? []) {
      if (recipe.status === 'check' && !badges.has(recipe.product_id)) {
        badges.set(recipe.product_id, { kind: 'check', label: 'Check stock', qty: null });
      }
    }
    return badges;
  }, [query.data]);
}
