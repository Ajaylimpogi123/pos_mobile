/** TanStack Query keys for orders. Everything lives under `['orders']`. */
import type { OrderStatus } from '@/services/types';

const root = ['orders'] as const;

export type OrderListFilters = {
  /** `YYYY-MM-DD`, or `null` for every date. */
  businessDate: string | null;
  /** Trimmed, debounced invoice search ('' = none). */
  search: string;
  /** Offline Sales (Phase 5): only the orders flagged for review. */
  needsReview: boolean;
  /** Voids & Refunds (Phase 7): one status, or `null` for every status. */
  status: OrderStatus | null;
};

export const orderKeys = {
  all: root,
  lists: () => [...root, 'list'] as const,
  list: (filters: OrderListFilters) => [...root, 'list', filters] as const,
  detail: (ulid: string) => [...root, 'detail', ulid] as const,
};
