import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { customerKeys } from '@/hooks/customers/queryKeys';
import { useCursorList } from '@/hooks/useCursorList';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { createCustomer, deleteCustomer, getCustomer, listCustomers, updateCustomer } from '@/services/customers';
import type { Customer, CustomerUpdateRequest } from '@/services/types';

/** Customers per page on the list. */
export const CUSTOMER_PAGE_SIZE = 25;

/** GET /api/v1/customers with a search (names, email, contact). */
export function useCustomerList(search: string, enabled = true) {
  return useCursorList({
    enabled,
    queryKey: customerKeys.list(search),
    fetchPage: (cursor) =>
      listCustomers({ per_page: CUSTOMER_PAGE_SIZE, cursor, search: search === '' ? undefined : search }),
    keepPrevious: true,
  });
}

/** State for the customer list screen: the search (300 ms debounce) and the infinite list. */
export function useCustomerListScreen() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const list = useCustomerList(debouncedSearch);

  return {
    search,
    setSearch,
    searching: search.trim() !== debouncedSearch || list.grid.updating,
    filtersActive: debouncedSearch !== '',
    clearSearch: () => setSearch(''),
    list,
  };
}

/** GET /api/v1/customers/{id}. */
export function useCustomer(id: number | null) {
  return useQuery({
    queryKey: customerKeys.detail(id ?? -1),
    queryFn: () => getCustomer(id as number),
    enabled: id !== null,
  });
}

/** Customer mutations: each writes the detail cache and invalidates every customer list. */
export function useCustomerMutations() {
  const client = useQueryClient();

  function afterSave(customer: Customer) {
    client.setQueryData(customerKeys.detail(customer.id), customer);
    void client.invalidateQueries({ queryKey: customerKeys.lists() });
  }

  const create = useMutation({ mutationFn: createCustomer, onSuccess: afterSave });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: CustomerUpdateRequest }) => updateCustomer(id, body),
    onSuccess: afterSave,
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteCustomer(id),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: customerKeys.detail(id) });
      void client.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });

  return { create, update, remove };
}
