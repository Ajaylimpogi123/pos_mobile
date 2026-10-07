import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { menuKeys, type ProductListFilters } from '@/hooks/menu/queryKeys';
import { useCursorList } from '@/hooks/useCursorList';
import { getAdminProduct, listAdminProducts, updateProduct } from '@/services/adminCatalog';
import type { AdminProduct, CursorPage } from '@/services/types';
import { requestCatalogueSync } from '@/sync/catalogueSync';

/** Products per page on the admin list. */
export const PRODUCT_PAGE_SIZE = 25;

type ProductPages = InfiniteData<CursorPage<AdminProduct>, string | null>;

/** GET /api/v1/admin/products as a cursor-paginated infinite query. */
export function useAdminProductList(filters: ProductListFilters) {
  const list = useCursorList({
    queryKey: menuKeys.productList(filters),
    fetchPage: (cursor) =>
      listAdminProducts({
        per_page: PRODUCT_PAGE_SIZE,
        cursor,
        search: filters.search === '' ? undefined : filters.search,
        category_id: filters.categoryId ?? undefined,
        is_available: filters.availability === 'all' ? undefined : filters.availability === 'available',
      }),
    // Keep showing the previous results while a new search / filter loads.
    keepPrevious: true,
  });

  return { ...list, products: list.items };
}

/** GET /api/v1/admin/products/{id}. */
export function useAdminProduct(id: number | null) {
  return useQuery({
    queryKey: menuKeys.product(id ?? -1),
    queryFn: () => getAdminProduct(id as number),
    enabled: id !== null,
  });
}

/** Applies `patch` to product `id` in every cached admin product list. */
export function patchProductInLists(client: QueryClient, id: number, patch: Partial<AdminProduct>): void {
  client.setQueriesData<ProductPages>({ queryKey: menuKeys.productLists() }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            data: page.data.map((product) => (product.id === id ? { ...product, ...patch } : product)),
          })),
        }
      : data,
  );
}

/** Writes a fresh server copy of a product into the detail cache and every cached list. */
export function cacheSavedProduct(client: QueryClient, product: AdminProduct): void {
  client.setQueryData(menuKeys.product(product.id), product);
  patchProductInLists(client, product.id, product);
}

const TOGGLE_KEY = ['admin', 'menu', 'products', 'toggle-availability'] as const;

export type ToggleAvailabilityInput = { id: number; isAvailable: boolean };

type ToggleContext = { previous: boolean };

/**
 * The quick availability switch: `PATCH /api/v1/admin/products/{id}` with
 * `{ is_available }` only.
 * - Optimistic: every cached list (and the detail) flips immediately.
 * - On error: only that product is rolled back to its previous value, so
 *   concurrent toggles of other products are untouched.
 * - Success: the change is pulled into the on-device menu (catalogue sync).
 * - Settled: product lists are invalidated (a filtered list may now exclude it).
 */
export function useToggleProductAvailability() {
  const client = useQueryClient();

  return useMutation<AdminProduct, unknown, ToggleAvailabilityInput, ToggleContext>({
    mutationKey: TOGGLE_KEY,
    mutationFn: ({ id, isAvailable }) => updateProduct(id, { is_available: isAvailable }),
    onMutate: async ({ id, isAvailable }) => {
      await client.cancelQueries({ queryKey: menuKeys.productLists() });
      await client.cancelQueries({ queryKey: menuKeys.product(id) });
      const detail = client.getQueryData<AdminProduct>(menuKeys.product(id));
      patchProductInLists(client, id, { is_available: isAvailable });
      if (detail) client.setQueryData(menuKeys.product(id), { ...detail, is_available: isAvailable });
      return { previous: !isAvailable };
    },
    onError: (_error, { id }, context) => {
      if (!context) return;
      patchProductInLists(client, id, { is_available: context.previous });
      const detail = client.getQueryData<AdminProduct>(menuKeys.product(id));
      if (detail) client.setQueryData(menuKeys.product(id), { ...detail, is_available: context.previous });
    },
    onSuccess: (product) => {
      cacheSavedProduct(client, product);
      void requestCatalogueSync();
    },
    onSettled: () => client.invalidateQueries({ queryKey: menuKeys.productLists() }),
  });
}

/** Ids of products whose availability toggle is in flight (their switches are disabled meanwhile). */
export function usePendingAvailabilityIds(): Set<number> {
  const ids = useMutationState({
    filters: { mutationKey: TOGGLE_KEY, status: 'pending' },
    select: (mutation) => (mutation.state.variables as ToggleAvailabilityInput | undefined)?.id,
  });
  return useMemo(() => new Set(ids.filter((id): id is number => typeof id === 'number')), [ids]);
}
