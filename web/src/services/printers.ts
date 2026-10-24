/**
 * Admin printers and receipt settings (permission `settings.manage`; the
 * server answers 403 without it). One function per endpoint.
 */
import { api, buildQuery } from '@/services/api';
import type {
  BranchSettings,
  BranchSettingsUpdateRequest,
  CursorPage,
  CursorParams,
  DataEnvelope,
  Printer,
  PrinterCreateRequest,
  PrinterUpdateRequest,
} from '@/services/types';

const PRINTERS = '/api/v1/admin/printers';
const SETTINGS = '/api/v1/admin/settings';

/** GET /api/v1/admin/printers: disabled printers included, by name then id. */
export async function listAdminPrinters(params: CursorParams = {}): Promise<CursorPage<Printer>> {
  return api.get<CursorPage<Printer>>(`${PRINTERS}${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`);
}

/** GET /api/v1/admin/printers/{id}. */
export async function getAdminPrinter(id: number): Promise<Printer> {
  const response = await api.get<DataEnvelope<Printer>>(`${PRINTERS}/${id}`);
  return response.data;
}

/** POST /api/v1/admin/printers → 201. 409 at the 20-printer limit. */
export async function createPrinter(body: PrinterCreateRequest): Promise<Printer> {
  const response = await api.post<DataEnvelope<Printer>>(PRINTERS, body);
  return response.data;
}

/** PATCH /api/v1/admin/printers/{id}: partial; `category_ids` replaces the routes. */
export async function updatePrinter(id: number, body: PrinterUpdateRequest): Promise<Printer> {
  const response = await api.patch<DataEnvelope<Printer>>(`${PRINTERS}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/printers/{id} → 204 (soft delete). */
export async function deletePrinter(id: number): Promise<void> {
  await api.delete<void>(`${PRINTERS}/${id}`);
}

/** GET /api/v1/admin/settings: defaults filled in. */
export async function getBranchSettings(): Promise<BranchSettings> {
  const response = await api.get<DataEnvelope<BranchSettings>>(SETTINGS);
  return response.data;
}

/** PATCH /api/v1/admin/settings: partial. */
export async function updateBranchSettings(body: BranchSettingsUpdateRequest): Promise<BranchSettings> {
  const response = await api.patch<DataEnvelope<BranchSettings>>(SETTINGS, body);
  return response.data;
}
