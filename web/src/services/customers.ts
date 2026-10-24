/**
 * Customers (Staff & Customers → Customer endpoints). Reads: any
 * authenticated user. Create and edit: `sale.create`. Delete: `customer.manage`.
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  Customer,
  CustomerCreateRequest,
  CustomerListParams,
  CustomerUpdateRequest,
  DataEnvelope,
} from '@/services/types';

const CUSTOMERS = '/api/v1/customers';

/** GET /api/v1/customers: `search` on names, email and (phone-like terms) contact. */
export async function listCustomers(params: CustomerListParams = {}): Promise<CursorPage<Customer>> {
  return api.get<CursorPage<Customer>>(
    `${CUSTOMERS}${buildQuery({ per_page: params.per_page, cursor: params.cursor, search: params.search })}`,
  );
}

/** GET /api/v1/customers/{id}. */
export async function getCustomer(id: number): Promise<Customer> {
  const response = await api.get<DataEnvelope<Customer>>(`${CUSTOMERS}/${id}`);
  return response.data;
}

/** POST /api/v1/customers → 201. */
export async function createCustomer(body: CustomerCreateRequest): Promise<Customer> {
  const response = await api.post<DataEnvelope<Customer>>(CUSTOMERS, body);
  return response.data;
}

/** PATCH /api/v1/customers/{id}: partial. */
export async function updateCustomer(id: number, body: CustomerUpdateRequest): Promise<Customer> {
  const response = await api.patch<DataEnvelope<Customer>>(`${CUSTOMERS}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/customers/{id} → 204 (soft delete). */
export async function deleteCustomer(id: number): Promise<void> {
  await api.delete<void>(`${CUSTOMERS}/${id}`);
}
