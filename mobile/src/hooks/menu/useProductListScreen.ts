import { useMemo, useState } from 'react';

import type { ProductAvailabilityFilter, ProductListFilters } from '@/hooks/menu/queryKeys';
import { useAllAdminCategories } from '@/hooks/menu/useAdminCategories';
import {
  useAdminProductList,
  usePendingAvailabilityIds,
  useToggleProductAvailability,
} from '@/hooks/menu/useAdminProducts';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { getErrorMessage } from '@/services/api';
import type { AdminProduct } from '@/services/types';


/**
 * State for the admin products screen: filters (search debounced by 300 ms,
 * category, availability), the infinite list, the category chips, and the
 * optimistic availability toggle with its error message.
 */
export function useProductListScreen() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [availability, setAvailability] = useState<ProductAvailabilityFilter>('all');
  const [toggleError, setToggleError] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const filters = useMemo<ProductListFilters>(
    () => ({ search: debouncedSearch, categoryId, availability }),
    [debouncedSearch, categoryId, availability],
  );

  const list = useAdminProductList(filters);
  const categories = useAllAdminCategories();
  const toggle = useToggleProductAvailability();
  const pendingIds = usePendingAvailabilityIds();

  const filtersActive = filters.search !== '' || categoryId !== null || availability !== 'all';

  function clearFilters() {
    setSearch('');
    setCategoryId(null);
    setAvailability('all');
  }

  function toggleAvailable(product: AdminProduct, isAvailable: boolean) {
    setToggleError(null);
    toggle.mutate(
      { id: product.id, isAvailable },
      {
        onError: (error) => {
          setToggleError(`Couldn't mark “${product.name}” as ${isAvailable ? 'available' : 'unavailable'}. ${getErrorMessage(error)}`);
        },
      },
    );
  }

  return {
    search,
    setSearch,
    /** The typed search hasn't been applied yet, or its results are still loading. */
    searching: search.trim() !== debouncedSearch || (list.isFetching && list.isPlaceholderData),
    categoryId,
    setCategoryId,
    availability,
    setAvailability,
    filtersActive,
    clearFilters,
    list,
    categories: categories.categories,
    toggleAvailable,
    pendingIds,
    toggleError,
    dismissToggleError: () => setToggleError(null),
  };
}
