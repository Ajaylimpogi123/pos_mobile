import { useMemo } from 'react';

import { ListFilters } from '@/components/shared/ListFilters';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import type { ProductAvailabilityFilter } from '@/hooks/menu/queryKeys';
import type { Category } from '@/services/types';

const AVAILABILITY: readonly SegmentOption<ProductAvailabilityFilter>[] = [
  { value: 'all', label: 'All', testID: 'availability-all' },
  { value: 'available', label: 'Available', testID: 'availability-available' },
  { value: 'unavailable', label: 'Unavailable', testID: 'availability-unavailable' },
];

type ProductFiltersProps = {
  search: string;
  onSearchChange: (text: string) => void;
  /** The debounced search is loading. */
  searching: boolean;
  categories: readonly Category[];
  categoryId: number | null;
  onCategoryChange: (id: number | null) => void;
  availability: ProductAvailabilityFilter;
  onAvailabilityChange: (value: ProductAvailabilityFilter) => void;
};

/** Product list filters: search (name or SKU), availability, and category chips (see `ListFilters`). */
export function ProductFilters({
  search,
  onSearchChange,
  searching,
  categories,
  categoryId,
  onCategoryChange,
  availability,
  onAvailabilityChange,
}: ProductFiltersProps) {
  const chips = useMemo(() => categories.map((category) => ({ id: category.id, label: category.name })), [categories]);

  return (
    <ListFilters
      search={search}
      onSearchChange={onSearchChange}
      searching={searching}
      placeholder="Name or SKU"
      searchTestID="product-search"
      segment={{
        options: AVAILABILITY,
        value: availability,
        onChange: onAvailabilityChange,
        accessibilityLabel: 'Availability',
        testID: 'availability-filter',
      }}
      chips={{
        items: chips,
        selectedId: categoryId,
        onChange: onCategoryChange,
        allLabel: 'All categories',
        testIDPrefix: 'category-chip',
      }}
    />
  );
}
