/**
 * TanStack Query keys for the menu admin. Everything lives under
 * `['admin', 'menu']`, so broad invalidations stay simple (and a sign-out
 * clears the whole cache anyway).
 */
export type ProductAvailabilityFilter = 'all' | 'available' | 'unavailable';

export type ProductListFilters = {
  /** Trimmed, debounced search text ('' = no filter). */
  search: string;
  categoryId: number | null;
  availability: ProductAvailabilityFilter;
};

const root = ['admin', 'menu'] as const;

export const menuKeys = {
  all: root,
  products: () => [...root, 'products'] as const,
  productLists: () => [...root, 'products', 'list'] as const,
  productList: (filters: ProductListFilters) => [...root, 'products', 'list', filters] as const,
  product: (id: number) => [...root, 'products', 'detail', id] as const,
  /** §J: every product's recipe (a §D1 cost change refreshes them all). */
  recipes: () => [...root, 'products', 'recipe'] as const,
  /** §J: a product's recipe (GET /admin/products/{id}/recipe). */
  recipe: (id: number) => [...root, 'products', 'recipe', id] as const,
  /** §J: the recipe component picker's own-stock products (under the lists, so product writes refresh it). */
  categories: () => [...root, 'categories'] as const,
  categoryLists: () => [...root, 'categories', 'list'] as const,
  categoryList: (pageSize: number) => [...root, 'categories', 'list', { pageSize }] as const,
  category: (id: number) => [...root, 'categories', 'detail', id] as const,
};
