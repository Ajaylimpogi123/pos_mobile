import { useState } from 'react';

import { PickerField } from '@/components/shared/PickerField';
import { PickerRow, SearchPickerSheet } from '@/components/shared/SearchPickerSheet';
import { Chip } from '@/components/ui/Chip';
import { usePurchaseItemPicker, type PurchaseItemOption } from '@/hooks/purchasing/usePurchaseItemPicker';
import { useSupplierList } from '@/hooks/suppliers/useSuppliers';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { PurchaseItemType, Supplier, SupplierRef } from '@/services/types';

type SupplierPickerFieldProps = {
  value: SupplierRef | null;
  onChange: (supplier: SupplierRef) => void;
  error?: string | null;
  disabled?: boolean;
  testID: string;
};

/** The supplier of a PR item or PO line: a field that opens the **active** suppliers, searchable. */
export function SupplierPickerField({ value, onChange, error, disabled, testID }: SupplierPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const list = useSupplierList(debounced, 'active', open);

  return (
    <>
      <PickerField
        label="Supplier"
        value={value?.name ?? ''}
        placeholder="Choose a supplier"
        icon="business-outline"
        onPress={() => setOpen(true)}
        error={error}
        disabled={disabled}
        testID={testID}
      />
      <SearchPickerSheet<Supplier>
        visible={open}
        title="Choose a supplier"
        onClose={() => setOpen(false)}
        search={search}
        onSearchChange={setSearch}
        placeholder="Name or contact"
        items={list.items}
        keyOf={(supplier) => String(supplier.id)}
        renderItem={(supplier) => (
          <PickerRow
            title={supplier.name}
            subtitle={supplier.contact_person ?? supplier.contact_number}
            icon="business-outline"
            selected={value?.id === supplier.id}
            onPress={() => {
              onChange({ id: supplier.id, name: supplier.name });
              setOpen(false);
            }}
            testID={`${testID}-option-${supplier.id}`}
          />
        )}
        loading={list.isPending}
        error={list.grid.error}
        onRetry={list.grid.onRetry}
        hasMore={Boolean(list.hasNextPage)}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={list.grid.fetchNextPage}
        empty={{ title: 'No active suppliers', message: 'Add one in Purchasing → Suppliers, or try another name.', icon: 'business-outline' }}
        testID={`${testID}-sheet`}
      />
    </>
  );
}

type ItemPickerFieldProps = {
  type: PurchaseItemType | null;
  itemId: number | null;
  name: string;
  onChange: (option: PurchaseItemOption) => void;
  error?: string | null;
  disabled?: boolean;
  testID: string;
};

/** The item of a PR row (§L): active ingredients, searchable. */
export function ItemPickerField({ type, itemId, name, onChange, error, disabled, testID }: ItemPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const picker = usePurchaseItemPicker(debounced, open);

  return (
    <>
      <PickerField
        label="Item"
        value={name}
        placeholder="Choose an ingredient"
        icon={type === 'product' ? 'fast-food-outline' : 'nutrition-outline'}
        onPress={() => setOpen(true)}
        error={error}
        disabled={disabled}
        testID={testID}
      />
      <SearchPickerSheet<PurchaseItemOption>
        visible={open}
        title="Choose an ingredient"
        onClose={() => setOpen(false)}
        search={search}
        onSearchChange={setSearch}
        placeholder="Search ingredients"
        items={picker.options}
        keyOf={(option) => option.key}
        renderItem={(option) => (
          <PickerRow
            title={option.name}
            subtitle={option.ingredient ? `Base unit: ${option.ingredient.base_unit}` : 'Counted in pieces'}
            icon={option.type === 'product' ? 'fast-food-outline' : 'nutrition-outline'}
            selected={option.type === type && option.id === itemId}
            trailing={<Chip label={option.type === 'product' ? 'Product' : 'Ingredient'} />}
            onPress={() => {
              onChange(option);
              setOpen(false);
            }}
            testID={`${testID}-option-${option.key}`}
          />
        )}
        loading={picker.loading}
        error={picker.error}
        onRetry={picker.retry}
        hasMore={picker.hasMore}
        loadingMore={picker.loadingMore}
        onLoadMore={picker.loadMore}
        empty={{ title: 'No ingredients found', message: 'Active ingredients show here.', icon: 'search-outline' }}
        testID={`${testID}-sheet`}
      />
    </>
  );
}
