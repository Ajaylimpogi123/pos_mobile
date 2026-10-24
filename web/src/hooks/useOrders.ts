/**
 * Order history (Core Sale → GET /orders, GET /orders/{ulid}): the cursor
 * list with the filters the contract supports (business date, invoice search,
 * status, Needs review), one order's detail, and the Needs review count shown
 * on the sidebar (`order.review`).
 */
import { useQuery } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { getErrorMessage } from '@/services/api';
import { getOrder, listOrders } from '@/services/orders';
import type { OrderStatus } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

export type OrderFilters = {
  businessDate: string | null;
  search: string;
  status: OrderStatus | null;
  /** Offline Sales: only the orders flagged for review (`needs_review=1`). */
  needsReview: boolean;
};

export const orderKeys = {
  all: ['orders'] as const,
  lists: ['orders', 'list'] as const,
  list: (filters: OrderFilters) => ['orders', 'list', filters] as const,
  detail: (ulid: string) => ['orders', 'detail', ulid] as const,
  needsReviewCount: ['orders', 'needs-review-count'] as const,
};

/** The sidebar badge reads one page of this size: a full page shows "99+". */
export const NEEDS_REVIEW_PAGE = 99;

export function useOrderList(filters: OrderFilters) {
  return useCursorList(orderKeys.list(filters), (cursor) =>
    listOrders({
      cursor,
      per_page: 25,
      business_date: filters.businessDate ?? undefined,
      search: filters.search.trim() || undefined,
      status: filters.status ?? undefined,
      needs_review: filters.needsReview || undefined,
    }),
  );
}

export function useOrderDetail(ulid: string | null) {
  const query = useQuery({
    queryKey: orderKeys.detail(ulid ?? ''),
    queryFn: () => getOrder(ulid as string),
    enabled: ulid !== null,
  });
  return {
    order: query.data ?? null,
    loading: ulid !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
    /** Re-reads the order (awaitable: a refund re-prices from it). */
    refetch: () => query.refetch(),
  };
}

/**
 * How many sales wait for review (`order.review` only): the first page of
 * `GET /orders?needs_review=1`. `null` while unknown (or on an error: the badge hides).
 */
export function useNeedsReviewCount(): { count: number; more: boolean } | null {
  const canReview = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.orderReview));
  const query = useQuery({
    queryKey: orderKeys.needsReviewCount,
    queryFn: () => listOrders({ needs_review: true, per_page: NEEDS_REVIEW_PAGE }),
    enabled: canReview,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  if (!canReview || !query.data) return null;
  return { count: query.data.data.length, more: query.data.meta.next_cursor !== null };
}
