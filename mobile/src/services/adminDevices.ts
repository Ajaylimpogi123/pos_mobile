/**
 * Hardening & Pilot (Phase 8) §C: admin Devices (`system.manage`, branch-scoped).
 * One function per contract endpoint, through the shared client (`@/services/api`).
 */
import { api, buildQuery } from '@/services/api';
import type {
  AdminDevice,
  AdminDeviceQuery,
  AdminDeviceRenameRequest,
  AdminDeviceRetireRequest,
  CursorPage,
  DataEnvelope,
} from '@/services/types';

const DEVICES = '/api/v1/admin/devices';

/** GET /api/v1/admin/devices: active first, then by `code`. `status` (default `active`), `platform`, `search`. */
export async function listAdminDevices(params: AdminDeviceQuery = {}): Promise<CursorPage<AdminDevice>> {
  return api.get<CursorPage<AdminDevice>>(
    `${DEVICES}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      status: params.status,
      platform: params.platform,
      search: params.search,
    })}`,
  );
}

/** GET /api/v1/admin/devices/{id} (Q-043): one device, retired included; 404 outside the branch. */
export async function getAdminDevice(id: number): Promise<AdminDevice> {
  const response = await api.get<DataEnvelope<AdminDevice>>(`${DEVICES}/${id}`);
  return response.data;
}

/** PATCH /api/v1/admin/devices/{id} `{ name }` (max 60). */
export async function renameDevice(id: number, body: AdminDeviceRenameRequest): Promise<AdminDevice> {
  const response = await api.patch<DataEnvelope<AdminDevice>>(`${DEVICES}/${id}`, body);
  return response.data;
}

/**
 * POST /api/v1/admin/devices/{id}/retire `{ confirm? }`. `409` with the server's
 * message ("T02 still has 5 unsynced sales. …") when unsynced sales were reported
 * and `confirm` isn't true: the screen asks, then retries with `confirm: true`.
 */
export async function retireDevice(id: number, body: AdminDeviceRetireRequest = {}): Promise<AdminDevice> {
  const response = await api.post<DataEnvelope<AdminDevice>>(`${DEVICES}/${id}/retire`, body);
  return response.data;
}

/** POST /api/v1/admin/devices/{id}/restore: reactivates the device. */
export async function restoreDevice(id: number): Promise<AdminDevice> {
  const response = await api.post<DataEnvelope<AdminDevice>>(`${DEVICES}/${id}/restore`);
  return response.data;
}
