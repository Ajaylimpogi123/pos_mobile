/**
 * TanStack Query keys for Inventory (v1 completion). Everything lives under
 * `['inventory']`, so a write can refresh the list, the item and its history
 * with one invalidation.
 */
import type { StockMovementType, StockStatusFilter } from '@/services/types';

export type InventoryListFilters = {
  /** Trimmed, debounced search text ('' = no filter). */
  search: string;
  categoryId: number | null;
  /** `null` = every status. */
  status: StockStatusFilter | null;
};

const root = ['inventory'] as const;

export const inventoryKeys = {
  all: root,
  lists: () => [...root, 'list'] as const,
  list: (filters: InventoryListFilters) => [...root, 'list', filters] as const,
  item: (productId: number) => [...root, 'item', productId] as const,
  movements: (productId: number) => [...root, 'movements', productId] as const,
  movementList: (productId: number, type: StockMovementType | null) => [...root, 'movements', productId, { type }] as const,
  /** `admin`: every category (with `product.manage`); `read`: the active ones. */
  categories: (source: 'admin' | 'read') => [...root, 'categories', source] as const,
};
