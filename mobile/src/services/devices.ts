/**
 * Feature: Offline Sales (Phase 5): device registration. One function per
 * contract endpoint, through the shared client (`@/services/api`).
 */
import { api } from '@/services/api';
import type { DataEnvelope, DeviceRegisterRequest, RegisteredDevice } from '@/services/types';

/**
 * POST /api/v1/devices/register → 200 `{ data: { id, code, name } }`. Finds or
 * creates the device with this `install_id` in the caller's branch and binds
 * the current token to it. `409` when the tablet belongs to another branch.
 */
export async function registerDevice(body: DeviceRegisterRequest): Promise<RegisteredDevice> {
  const response = await api.post<DataEnvelope<RegisteredDevice>>('/api/v1/devices/register', body);
  return response.data;
}
