import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { orderKeys, type OrderListFilters } from '@/hooks/orders/queryKeys';
import { localSummaryOf, useLocalOrder, useLocalOrders, type LocalOrderBadge, type LocalOrderSummary } from '@/hooks/orders/useLocalOrders';
import { useKeyedCursorList } from '@/hooks/useCursorList';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useNow } from '@/hooks/useNow';
import { getOrder, listOrders } from '@/services/orders';
import type { OrderStatus, OrderSummary, PrintableOrder } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { addBusinessDays, businessDateAt } from '@/utils/businessDay';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/** Orders per page. */
export const ORDER_PAGE_SIZE = 25;

/** Contract: `search` is `max:30` (contains on `invoice_no`). */
export const ORDER_SEARCH_MAX_LENGTH = 30;

/** How often "today" is re-evaluated while the list is open (the business day can roll over). */
const TODAY_REFRESH_MS = 60_000;

/** `null`: today (follows the business day); `'all'`: every date; else a `YYYY-MM-DD` label. */
export type OrderDateSelection = null | 'all' | string;

/**
 * One card of the Orders list: an order from the API, or (Offline Sales) a
 * sale saved on this tablet that hasn't synced yet, with its badge.
 */
export type OrderListEntry =
  | { kind: 'server'; key: string; order: OrderSummary }
  | { kind: 'local'; key: string; order: LocalOrderSummary; badge: LocalOrderBadge; lastError: string | null };

function ulidOf(order: OrderSummary): string {
  return order.ulid;
}

/** GET /api/v1/orders with a business date, an invoice search or the needs-review filter, newest first. */
export function useOrderList(filters: OrderListFilters) {
  return useKeyedCursorList({
    queryKey: orderKeys.list(filters),
    fetchPage: (cursor) =>
      listOrders({
        per_page: ORDER_PAGE_SIZE,
        cursor,
        business_date: filters.businessDate ?? undefined,
        search: filters.search === '' ? undefined : filters.search,
        needs_review: filters.needsReview || undefined,
        status: filters.status ?? undefined,
      }),
    keepPrevious: true,
    keyOf: ulidOf,
  });
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * State for the Orders list: it defaults to **today's business date** (the
 * branch's timezone and day start, from the signed-in user), steps a day at
 * a time (never past today) or shows every date, and searches invoice
 * numbers (300 ms debounce). The server shows only the user's own orders
 * unless they have `report.view`.
 *
 * Offline Sales (Phase 5):
 * - The day's local `pending` and `needs_attention` sales come **first**, with
 *   a badge (not while searching invoice numbers: they have none yet). A sale
 *   the API already lists shows once, from the API.
 * - With `order.review`, a **Needs review** filter (every date); the dashboard
 *   insight opens Orders with it on (`?review=1`).
 */
export function useOrderListScreen() {
  const user = useSessionStore((state) => state.user);
  const branch = user?.branch ?? null;
  const canReview = hasPermission(user, PERMISSIONS.orderReview);
  const params = useLocalSearchParams<{ review?: string }>();
  const now = useNow(TODAY_REFRESH_MS);
  const today = branch ? businessDateAt(now, branch.timezone, branch.day_start_time) : null;

  const [selection, setSelection] = useState<OrderDateSelection>(null);
  const [needsReviewChosen, setNeedsReview] = useState(() => firstParam(params.review) === '1');
  const [search, setSearch] = useState('');
  /** Voids & Refunds (Phase 7): the Status filter (`null`: every status). */
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  const needsReview = canReview && needsReviewChosen;
  const businessDate = needsReview || selection === 'all' ? null : (selection ?? today);
  const filters = useMemo<OrderListFilters>(
    () => ({ businessDate, search: debouncedSearch, needsReview, status }),
    [businessDate, debouncedSearch, needsReview, status],
  );
  const list = useOrderList(filters);
  // Unsynced local sales are always `completed`: they show unless another status is chosen.
  const localRecords = useLocalOrders(businessDate, !needsReview && debouncedSearch === '' && (status === null || status === 'completed'));

  const entries = useMemo<OrderListEntry[]>(() => {
    const fromServer = new Set(list.items.map((order) => order.ulid));
    const local: OrderListEntry[] = localRecords
      .filter((record) => !fromServer.has(record.ulid) && record.status !== 'synced')
      .map((record) => ({
        kind: 'local',
        key: record.ulid,
        order: localSummaryOf(record.order),
        badge: record.status === 'needs_attention' ? 'needs_attention' : 'pending',
        lastError: record.lastError,
      }));
    const server: OrderListEntry[] = list.items.map((order) => ({ kind: 'server', key: order.ulid, order }));
    return [...local, ...server];
  }, [list.items, localRecords]);

  const isToday = !needsReview && businessDate !== null && businessDate === today;

  function step(days: number) {
    if (businessDate === null) return;
    const next = addBusinessDays(businessDate, days);
    // Never past today; "today" itself is kept as `null` so it follows the rollover.
    if (today !== null && next >= today) setSelection(null);
    else setSelection(next);
  }

  return {
    today,
    businessDate,
    isToday,
    allDates: !needsReview && selection === 'all',
    previousDay: () => step(-1),
    nextDay: () => step(1),
    canGoNext: businessDate !== null && today !== null && businessDate < today,
    showToday: () => {
      setNeedsReview(false);
      setSelection(null);
    },
    showAllDates: () => {
      setNeedsReview(false);
      setSelection('all');
    },
    /** `order.review`: the Needs review filter chip. */
    canReview,
    needsReview,
    toggleNeedsReview: () => setNeedsReview((current) => !current),
    search,
    setSearch,
    clearSearch: () => {
      setSearch('');
      setStatus(null);
    },
    searching: search.trim() !== debouncedSearch || list.grid.updating,
    filtersActive: debouncedSearch !== '' || status !== null,
    /** Phase 7: the Status filter. */
    status,
    setStatus,
    list,
    /** The cards: the unsynced local sales first, then the API's orders. */
    entries,
  };
}

/** GET /api/v1/orders/{ulid}. */
export function useOrder(ulid: string | null) {
  return useQuery({
    queryKey: orderKeys.detail(ulid ?? ''),
    queryFn: () => getOrder(ulid as string),
    enabled: ulid !== null,
  });
}

export type OrderDetailSource =
  /** Saved on this tablet and not synced: read from the local JSON. */
  | { kind: 'local'; order: PrintableOrder; badge: LocalOrderBadge; lastError: string | null }
  /** From the API (or, when it can't be reached, the server `Order` stored with a synced local sale). */
  | { kind: 'server'; order: PrintableOrder };

/**
 * One order for the detail screen (Offline Sales → Orders module): a local
 * sale that hasn't synced is read from its local JSON (with Reprint); every
 * other order comes from `GET /orders/{ulid}` as before. A synced local sale
 * falls back to the server `Order` stored with it when the API can't answer.
 */
export function useOrderDetail(ulid: string | null) {
  const local = useLocalOrder(ulid);
  const record = local.record;
  const unsynced = record !== null && record.status !== 'synced';
  const query = useQuery({
    queryKey: orderKeys.detail(ulid ?? ''),
    queryFn: () => getOrder(ulid as string),
    enabled: ulid !== null && !local.loading && !unsynced,
  });

  let source: OrderDetailSource | null = null;
  if (record && unsynced) {
    source = {
      kind: 'local',
      order: record.order,
      badge: record.status === 'needs_attention' ? 'needs_attention' : 'pending',
      lastError: record.lastError,
    };
  } else if (query.data) {
    source = { kind: 'server', order: query.data };
  } else if (query.isError && record?.serverOrder) {
    source = { kind: 'server', order: record.serverOrder };
  }

  return { source, loading: local.loading || (query.isPending && query.fetchStatus !== 'idle'), query };
}
