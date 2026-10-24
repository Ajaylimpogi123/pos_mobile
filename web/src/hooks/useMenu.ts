/**
 * The Sell screen's menu: every active category (`GET /categories`) and every
 * product on the menu (`GET /products`, unavailable ones included), read page
 * by page through `meta.next_cursor` (100 per page).
 *
 * Like the tablet's on-device catalogue, the whole menu is held at once so
 * category switching, search and the arrow keys are instant for the cashier;
 * the server still checks every line of a sale. Filtering mirrors the server's
 * own rules: `category_id`, and a case-insensitive "contains" on `name` or `sku`.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getErrorMessage } from '@/services/api';
import { listCategories, listProducts } from '@/services/catalog';
import type { Category, CursorPage, Product } from '@/services/types';

export const menuKeys = {
  all: ['menu'] as const,
  categories: ['menu', 'categories'] as const,
  products: ['menu', 'products'] as const,
};

/** Safety cap: 50 pages of 100 (the catalogue is bounded; this only stops a runaway cursor). */
const MAX_PAGES = 50;

async function readAll<T>(fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.data);
    if (!result.meta.next_cursor) break;
    cursor = result.meta.next_cursor;
  }
  return items;
}

export function fetchAllProducts(): Promise<Product[]> {
  return readAll((cursor) => listProducts({ per_page: 100, cursor }));
}

export function useMenu() {
  const categories = useQuery({
    queryKey: menuKeys.categories,
    queryFn: () => readAll<Category>((cursor) => listCategories({ per_page: 100, cursor })),
    staleTime: 5 * 60_000,
  });
  const products = useQuery({
    queryKey: menuKeys.products,
    queryFn: fetchAllProducts,
    staleTime: 5 * 60_000,
  });

  const error = categories.isError ? categories.error : products.isError ? products.error : null;

  return {
    categories: categories.data ?? [],
    products: products.data ?? [],
    loading: categories.isPending || products.isPending,
    error: error ? getErrorMessage(error) : null,
    refreshing: categories.isFetching || products.isFetching,
    reload: () => {
      void categories.refetch();
      void products.refetch();
    },
  };
}

/** The products of a category (`null`: all) matching `search` on name or SKU, in the server's order. */
export function useFilteredProducts(products: readonly Product[], categoryId: number | null, search: string): Product[] {
  return useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId !== null && product.category.id !== categoryId) return false;
      if (term === '') return true;
      return product.name.toLowerCase().includes(term) || (product.sku?.toLowerCase().includes(term) ?? false);
    });
  }, [products, categoryId, search]);
}
