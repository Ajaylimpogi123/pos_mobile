/**
 * Admin devices (Hardening & Pilot §C), permission `system.manage`, branch-scoped:
 * tablets and web terminals with their derived `health`, rename, retire, restore.
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

/** GET /api/v1/admin/devices: active first, then by `code`. `status` defaults to `active`. */
export async function listAdminDevices(query: AdminDeviceQuery = {}): Promise<CursorPage<AdminDevice>> {
  return api.get<CursorPage<AdminDevice>>(
    `${DEVICES}${buildQuery({
      per_page: query.per_page,
      cursor: query.cursor,
      status: query.status,
      platform: query.platform,
      search: query.search,
    })}`,
  );
}

/** PATCH /api/v1/admin/devices/{id} `{name}` (max 60). */
export async function renameAdminDevice(id: number, body: AdminDeviceRenameRequest): Promise<AdminDevice> {
  const response = await api.patch<DataEnvelope<AdminDevice>>(`${DEVICES}/${id}`, body);
  return response.data;
}

/**
 * POST /api/v1/admin/devices/{id}/retire `{confirm?}`. A tablet whose last heartbeat
 * reported unsynced sales answers `409` (with the count in the message) until `confirm: true`.
 */
export async function retireAdminDevice(id: number, body: AdminDeviceRetireRequest = {}): Promise<AdminDevice> {
  const response = await api.post<DataEnvelope<AdminDevice>>(`${DEVICES}/${id}/retire`, body);
  return response.data;
}

/** POST /api/v1/admin/devices/{id}/restore: staff sign in on it again. */
export async function restoreAdminDevice(id: number): Promise<AdminDevice> {
  const response = await api.post<DataEnvelope<AdminDevice>>(`${DEVICES}/${id}/restore`);
  return response.data;
}
