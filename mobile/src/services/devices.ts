/**
 * Feature: Offline Sales (Phase 5): device registration. One function per
 * contract endpoint, through the shared client (`@/services/api`).
 */
import { api } from '@/services/api';
import type {
  AppVersionInfo,
  DataEnvelope,
  DeviceRegisterRequest,
  HeartbeatRequest,
  HeartbeatResponse,
  RegisteredDevice,
} from '@/services/types';

/**
 * POST /api/v1/devices/register → 200 `{ data: { id, code, name } }`. Finds or
 * creates the device with this `install_id` in the caller's branch and binds
 * the current token to it. `409` when the tablet belongs to another branch.
 */
export async function registerDevice(body: DeviceRegisterRequest): Promise<RegisteredDevice> {
  const response = await api.post<DataEnvelope<RegisteredDevice>>('/api/v1/devices/register', body);
  return response.data;
}

/**
 * Hardening & Pilot §C: POST /api/v1/devices/heartbeat → 200 `{ data: { server_time, app } }`.
 * `409 "Register this tablet first."` when the token isn't bound to a device.
 */
export async function sendHeartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse> {
  const response = await api.post<DataEnvelope<HeartbeatResponse>>('/api/v1/devices/heartbeat', body);
  return response.data;
}

/** §C: GET /api/v1/app-version (no auth) → `{ data: AppVersionInfo }`. */
export async function getAppVersionInfo(): Promise<AppVersionInfo> {
  const response = await api.get<DataEnvelope<AppVersionInfo>>('/api/v1/app-version', { auth: false });
  return response.data;
}
