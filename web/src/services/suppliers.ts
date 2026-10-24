/**
 * Suppliers (Ingredients, Recipes & Purchasing §C): managed with
 * `supplier.manage`; list and read with any purchase permission.
 */
import { api, buildQuery } from '@/services/api';
import type { CursorPage, DataEnvelope, Supplier, SupplierCreateRequest, SupplierListParams, SupplierUpdateRequest } from '@/services/types';

const SUPPLIERS = '/api/v1/admin/suppliers';

/** GET /api/v1/admin/suppliers: `search` (name or contact), `is_active`. */
export async function listSuppliers(params: SupplierListParams = {}): Promise<CursorPage<Supplier>> {
  return api.get<CursorPage<Supplier>>(
    `${SUPPLIERS}${buildQuery({ per_page: params.per_page, cursor: params.cursor, search: params.search, is_active: params.is_active })}`,
  );
}

/** GET /api/v1/admin/suppliers/{id}. */
export async function getSupplier(id: number): Promise<Supplier> {
  const response = await api.get<DataEnvelope<Supplier>>(`${SUPPLIERS}/${id}`);
  return response.data;
}

/** POST /api/v1/admin/suppliers → 201. */
export async function createSupplier(body: SupplierCreateRequest): Promise<Supplier> {
  const response = await api.post<DataEnvelope<Supplier>>(SUPPLIERS, body);
  return response.data;
}

/** PATCH /api/v1/admin/suppliers/{id}: partial. */
export async function updateSupplier(id: number, body: SupplierUpdateRequest): Promise<Supplier> {
  const response = await api.patch<DataEnvelope<Supplier>>(`${SUPPLIERS}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/suppliers/{id} → 204. 409 when on a PR or PO ("Deactivate it instead."). */
export async function deleteSupplier(id: number): Promise<void> {
  await api.delete<void>(`${SUPPLIERS}/${id}`);
}
