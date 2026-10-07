import { useQuery } from '@tanstack/react-query';

import { menuKeys } from '@/hooks/menu/queryKeys';
import { useCursorList } from '@/hooks/useCursorList';
import { getAdminCategory, listAdminCategories } from '@/services/adminCatalog';

/** Categories per page on the admin categories grid. */
export const CATEGORY_PAGE_SIZE = 25;
/** The contract's hard maximum: used where the whole list is needed (filter chips, picker). */
export const CATEGORY_MAX_PAGE_SIZE = 100;

/** GET /api/v1/admin/categories as a cursor-paginated infinite query. */
export function useAdminCategoryList(pageSize: number = CATEGORY_PAGE_SIZE, fetchAll = false) {
  const list = useCursorList({
    queryKey: menuKeys.categoryList(pageSize),
    fetchPage: (cursor) => listAdminCategories({ per_page: pageSize, cursor }),
    fetchAll,
  });
  return { ...list, categories: list.items };
}

/**
 * Every admin category (for the filter chips and the product form's picker).
 * Pages of 100 are followed automatically until `next_cursor` is null; a
 * restaurant menu rarely needs more than one page.
 */
export function useAllAdminCategories() {
  return useAdminCategoryList(CATEGORY_MAX_PAGE_SIZE, true);
}

/** GET /api/v1/admin/categories/{id}. */
export function useAdminCategory(id: number | null) {
  return useQuery({
    queryKey: menuKeys.category(id ?? -1),
    queryFn: () => getAdminCategory(id as number),
    enabled: id !== null,
  });
}
