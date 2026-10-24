/**
 * Suppliers (Ingredients, Recipes & Purchasing §C): the list (`search`,
 * `is_active`), the read, the save (POST / PATCH with the changed fields),
 * deactivate / reactivate (`PATCH is_active`), the delete (a 409 when the
 * supplier is on a PR or PO: "Deactivate it instead."), and the picker of
 * active suppliers used by the purchase request and order forms.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { getErrorMessage } from '@/services/api';
import { createSupplier, deleteSupplier, getSupplier, listSuppliers, updateSupplier } from '@/services/suppliers';
import type { Supplier, SupplierCreateRequest, SupplierUpdateRequest } from '@/services/types';

export const supplierKeys = {
  all: ['admin', 'suppliers'] as const,
  list: (search: string, isActive: boolean | null) => ['admin', 'suppliers', 'list', search, isActive] as const,
  options: (search: string) => ['admin', 'suppliers', 'options', search] as const,
  detail: (id: number) => ['admin', 'suppliers', 'detail', id] as const,
};

export function useSupplierList(search: string, isActive: boolean | null) {
  return useCursorList(supplierKeys.list(search, isActive), (cursor) =>
    listSuppliers({ cursor, per_page: 25, search: search || undefined, is_active: isActive ?? undefined }),
  );
}

/** The supplier picker: active suppliers only, searched by name or contact. */
export function useSupplierOptions(search: string, enabled: boolean) {
  return useCursorList(supplierKeys.options(search), (cursor) => listSuppliers({ cursor, per_page: 25, search: search || undefined, is_active: true }), {
    enabled,
  });
}

export function useSupplier(id: number | null) {
  const query = useQuery({ queryKey: supplierKeys.detail(id ?? 0), queryFn: () => getSupplier(id as number), enabled: id !== null });
  return {
    supplier: query.data ?? null,
    loading: id !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

export function useSaveSupplier(id: number | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SupplierCreateRequest | SupplierUpdateRequest): Promise<Supplier> =>
      id === null ? createSupplier(body as SupplierCreateRequest) : updateSupplier(id, body),
    onSuccess: (saved) => {
      client.setQueryData(supplierKeys.detail(saved.id), saved);
      void client.invalidateQueries({ queryKey: supplierKeys.all });
    },
  });
}

/** Deactivate or reactivate (`PATCH { is_active }`). */
export function useSetSupplierActive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => updateSupplier(id, { is_active: isActive }),
    onSuccess: (saved) => {
      client.setQueryData(supplierKeys.detail(saved.id), saved);
      void client.invalidateQueries({ queryKey: supplierKeys.all });
    },
  });
}

export function useDeleteSupplier() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteSupplier(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: supplierKeys.all }),
  });
}
