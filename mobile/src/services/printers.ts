/**
 * Feature: Printing (Phase 4): admin printers (permission `settings.manage`;
 * the server answers 403 without it). One function per contract endpoint.
 * Everything is scoped to the caller's branch: another branch's printer is a 404.
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  Printer,
  PrinterCreateRequest,
  PrinterListParams,
  PrinterUpdateRequest,
} from '@/services/types';

const PRINTERS = '/api/v1/admin/printers';

/** GET /api/v1/admin/printers: disabled printers included, by `name` then `id`. */
export async function listAdminPrinters(params: PrinterListParams = {}): Promise<CursorPage<Printer>> {
  return api.get<CursorPage<Printer>>(`${PRINTERS}${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`);
}

/** POST /api/v1/admin/printers → 201. 409 at the 20-printer limit. */
export async function createPrinter(body: PrinterCreateRequest): Promise<Printer> {
  const response = await api.post<DataEnvelope<Printer>>(PRINTERS, body);
  return response.data;
}

/** GET /api/v1/admin/printers/{id}. */
export async function getAdminPrinter(id: number): Promise<Printer> {
  const response = await api.get<DataEnvelope<Printer>>(`${PRINTERS}/${id}`);
  return response.data;
}

/** PATCH /api/v1/admin/printers/{id}: partial; `category_ids` replaces the routes. */
export async function updatePrinter(id: number, body: PrinterUpdateRequest): Promise<Printer> {
  const response = await api.patch<DataEnvelope<Printer>>(`${PRINTERS}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/printers/{id} → 204 (soft delete; its routes and default flag are cleared). */
export async function deletePrinter(id: number): Promise<void> {
  await api.delete<void>(`${PRINTERS}/${id}`);
}
