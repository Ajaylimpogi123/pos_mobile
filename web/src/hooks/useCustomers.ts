/**
 * Customers (Staff & Customers → Customer endpoints): list and read for any
 * signed-in user, create and edit with `sale.create`, delete with `customer.manage`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { getErrorMessage } from '@/services/api';
import { createCustomer, deleteCustomer, getCustomer, listCustomers, updateCustomer } from '@/services/customers';
import type { Customer, CustomerCreateRequest, CustomerUpdateRequest } from '@/services/types';

export const customerKeys = {
  all: ['customers'] as const,
  list: (search: string) => ['customers', 'admin-list', search] as const,
  detail: (id: number) => ['customers', 'detail', id] as const,
};

/** Contract limits. */
export const CUSTOMER_LIMITS = { firstName: 60, lastName: 60, contact: 30, email: 255, notes: 500, search: 100 } as const;

/** Contract: digits, spaces and + ( ) - only. */
export const CONTACT_PATTERN = /^[0-9+()\-\s]+$/;

export function useCustomerList(search: string) {
  return useCursorList(customerKeys.list(search), (cursor) => listCustomers({ cursor, per_page: 25, search: search || undefined }));
}

export function useCustomer(id: number | null) {
  const query = useQuery({ queryKey: customerKeys.detail(id ?? 0), queryFn: () => getCustomer(id as number), enabled: id !== null });
  return {
    customer: query.data ?? null,
    loading: id !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

export function useSaveCustomer(id: number | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerCreateRequest | CustomerUpdateRequest): Promise<Customer> =>
      id === null ? createCustomer(body as CustomerCreateRequest) : updateCustomer(id, body),
    onSuccess: (saved) => {
      client.setQueryData(customerKeys.detail(saved.id), saved);
      void client.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useDeleteCustomer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCustomer(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: customerKeys.all }),
  });
}
