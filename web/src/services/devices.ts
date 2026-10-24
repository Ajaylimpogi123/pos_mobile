/**
 * Terminal endpoints: POST /api/v1/devices/register (Offline Sales, plus Web POS
 * §C `platform`) and POST /api/v1/devices/heartbeat (Hardening & Pilot §C).
 */
import { api } from '@/services/api';
import type { DataEnvelope, DeviceRegisterRequest, HeartbeatRequest, HeartbeatResponse, RegisteredDevice } from '@/services/types';

/** → 200 `{ data: { id, code, name, platform } }`. 409 another branch, 403 retired, 422 invalid. */
export async function registerDevice(body: DeviceRegisterRequest): Promise<RegisteredDevice> {
  const response = await api.post<DataEnvelope<RegisteredDevice>>('/api/v1/devices/register', body);
  return response.data;
}

/** → 200 `{ server_time, app }`. `409 "Register this tablet first."` when the token has no device. */
export async function sendHeartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse> {
  const response = await api.post<DataEnvelope<HeartbeatResponse>>('/api/v1/devices/heartbeat', body);
  return response.data;
}
