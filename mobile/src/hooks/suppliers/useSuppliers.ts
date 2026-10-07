import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { supplierKeys } from '@/hooks/purchasing/queryKeys';
import { useCursorList } from '@/hooks/useCursorList';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsOnline } from '@/hooks/useIsOnline';
import { createSupplier, deleteSupplier, getSupplier, listSuppliers, updateSupplier } from '@/services/suppliers';
import type { Supplier, SupplierUpdateRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/** Suppliers per page. */
export const SUPPLIER_PAGE_SIZE = 25;

export type SupplierSegment = 'all' | 'active' | 'inactive';

/** Who may create, edit and delete suppliers (reads need any purchase permission). */
export function useCanManageSuppliers(): boolean {
  return useSessionStore((state) => hasPermission(state.user, PERMISSIONS.supplierManage));
}

/** GET /api/v1/admin/suppliers with a search and an active filter. */
export function useSupplierList(search: string, segment: SupplierSegment, enabled = true) {
  return useCursorList<Supplier>({
    queryKey: supplierKeys.list({ search, segment }),
    fetchPage: (cursor) =>
      listSuppliers({
        per_page: SUPPLIER_PAGE_SIZE,
        cursor,
        search: search === '' ? undefined : search,
        is_active: segment === 'all' ? undefined : segment === 'active',
      }),
    keepPrevious: true,
    enabled,
  });
}

/** The supplier list screen: search (300 ms debounce), `All · Active · Inactive`, the cursor list. */
export function useSupplierListScreen() {
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<SupplierSegment>('all');
  const online = useIsOnline();
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const list = useSupplierList(debounced, segment, online);

  return {
    online,
    search,
    setSearch,
    searching: search.trim() !== debounced || list.grid.updating,
    segment,
    setSegment,
    filtersActive: debounced !== '' || segment !== 'all',
    clearFilters: () => {
      setSearch('');
      setSegment('all');
    },
    list,
  };
}

/** GET /api/v1/admin/suppliers/{id}. */
export function useSupplier(id: number | null) {
  return useQuery({
    queryKey: supplierKeys.detail(id ?? -1),
    queryFn: () => getSupplier(id as number),
    enabled: id !== null,
  });
}

/** Supplier mutations: each writes the detail cache and refreshes every supplier list. */
export function useSupplierMutations() {
  const client = useQueryClient();

  function afterSave(supplier: Supplier) {
    client.setQueryData(supplierKeys.detail(supplier.id), supplier);
    void client.invalidateQueries({ queryKey: supplierKeys.lists() });
  }

  const create = useMutation({ mutationFn: createSupplier, onSuccess: afterSave });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: SupplierUpdateRequest }) => updateSupplier(id, body),
    onSuccess: afterSave,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteSupplier(id),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: supplierKeys.detail(id) });
      void client.invalidateQueries({ queryKey: supplierKeys.lists() });
    },
  });

  return { create, update, remove };
}
