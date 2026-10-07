import { useQuery, useQueryClient, type QueryClient, type InfiniteData } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { inventoryKeys, type InventoryListFilters } from '@/hooks/inventory/queryKeys';
import { useCursorList, useKeyedCursorList } from '@/hooks/useCursorList';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsOnline } from '@/hooks/useIsOnline';
import { listAdminCategories } from '@/services/adminCatalog';
import { listCategories } from '@/services/catalog';
import { getInventoryItem, INVENTORY_MAX_PAGE_SIZE, listInventory, listInventoryMovements } from '@/services/inventory';
import type {
  InventoryItem,
  InventoryMovement,
  InventoryPage,
  InventorySummary,
  StockMovementType,
} from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';

/** Items per page on the inventory list and the history. */
export const INVENTORY_PAGE_SIZE = 25;

/** The segmented filter: All, Low, Out, and the dashboard's Low & out (`alerts`). */
export type InventorySegment = 'all' | 'low' | 'out' | 'alerts';

function itemKey(item: InventoryItem): number {
  return item.product_id;
}

function movementKey(movement: InventoryMovement): string {
  return movement.ulid;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Who may read Inventory, and who may write (stock in, count, wastage, reorder level). */
export function useInventoryPermissions() {
  const canRead = useSessionStore((state) =>
    hasAnyPermission(state.user, [PERMISSIONS.inventoryAdjust, PERMISSIONS.reportView]),
  );
  const canAdjust = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.inventoryAdjust));
  const canOpenOrders = useSessionStore((state) =>
    hasAnyPermission(state.user, [PERMISSIONS.saleCreate, PERMISSIONS.reportView]),
  );
  return { canRead, canAdjust, canOpenOrders };
}

/**
 * The category chips of the inventory list and report: every category with
 * `product.manage` (inventory includes products of inactive categories),
 * else the active ones from the read endpoint.
 */
export function useInventoryCategories(enabled = true) {
  const canManage = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.productManage));
  const source = canManage ? 'admin' : 'read';
  const list = useCursorList({
    queryKey: inventoryKeys.categories(source),
    fetchPage: (cursor) =>
      canManage
        ? listAdminCategories({ per_page: INVENTORY_MAX_PAGE_SIZE, cursor })
        : listCategories({ per_page: INVENTORY_MAX_PAGE_SIZE, cursor }),
    fetchAll: true,
    enabled,
  });
  const chips = useMemo(() => list.items.map((category) => ({ id: category.id, label: category.name })), [list.items]);
  return chips;
}

/**
 * State for the inventory list (`/inventory`): the segmented status filter
 * (`?status=alerts` from the dashboard opens Low & out), the pill search
 * (300 ms debounce), the category chips, and the cursor list with its
 * branch-wide `meta.summary`.
 */
export function useInventoryListScreen() {
  const params = useLocalSearchParams<{ status?: string | string[] }>();
  const fromAlerts = firstParam(params.status) === 'alerts';
  const [segment, setSegment] = useState<InventorySegment>(fromAlerts ? 'alerts' : 'all');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const online = useIsOnline();
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  const filters = useMemo<InventoryListFilters>(
    () => ({ search: debouncedSearch, categoryId, status: segment === 'all' ? null : segment }),
    [debouncedSearch, categoryId, segment],
  );

  const list = useKeyedCursorList<InventoryItem>({
    queryKey: inventoryKeys.list(filters),
    fetchPage: (cursor) =>
      listInventory({
        per_page: INVENTORY_PAGE_SIZE,
        cursor,
        search: filters.search === '' ? undefined : filters.search,
        category_id: filters.categoryId ?? undefined,
        status: filters.status ?? undefined,
      }),
    keepPrevious: true,
    keyOf: itemKey,
  });
  const categories = useInventoryCategories();

  const firstPage = list.data?.pages[0] as InventoryPage | undefined;
  const summary: InventorySummary | null = firstPage?.meta.summary ?? null;

  const filtersActive = filters.search !== '' || categoryId !== null || segment !== 'all';

  return {
    online,
    segment,
    setSegment,
    /** The Low & out option shows once the dashboard opened it. */
    showAlertsSegment: fromAlerts,
    search,
    setSearch,
    searching: search.trim() !== debouncedSearch || list.grid.updating,
    categoryId,
    setCategoryId,
    categories,
    filtersActive,
    clearFilters: () => {
      setSearch('');
      setCategoryId(null);
      setSegment('all');
    },
    summary,
    list,
  };
}

/** The item as the list pages already hold it (shown at once while the fresh copy loads). */
export function cachedInventoryItem(client: QueryClient, productId: number): InventoryItem | undefined {
  const lists = client.getQueriesData<InfiniteData<InventoryPage>>({ queryKey: inventoryKeys.lists() });
  for (const [, data] of lists) {
    for (const page of data?.pages ?? []) {
      const found = page.data.find((item) => item.product_id === productId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * GET /inventory/{product}: one product's `InventoryItem` for the detail
 * screen. The card the list already loaded shows as placeholder data while it
 * loads. Errors: 404 (unknown or deleted), 409 (doesn't track stock: the
 * history still shows). Refetched after every write and on pull-to-refresh.
 */
export function useInventoryItem(productId: number | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: inventoryKeys.item(productId ?? -1),
    queryFn: () => getInventoryItem(productId as number),
    enabled: productId !== null,
    placeholderData: () => (productId === null ? undefined : cachedInventoryItem(client, productId)),
  });
}

/** GET /inventory/{product}/movements with an optional type filter, as an infinite list. */
export function useInventoryMovements(productId: number | null, type: StockMovementType | null) {
  return useKeyedCursorList<InventoryMovement>({
    queryKey: inventoryKeys.movementList(productId ?? -1, type),
    fetchPage: (cursor) =>
      listInventoryMovements(productId as number, { per_page: INVENTORY_PAGE_SIZE, cursor, type: type ?? undefined }),
    keepPrevious: true,
    enabled: productId !== null,
    keyOf: movementKey,
  });
}

