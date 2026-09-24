/**
 * Feature: Auth & Access Control (Phase 0). One function per contract endpoint.
 * `GET /api/v1/admin/users` is backend-only in Phase 0 and deliberately not consumed.
 */
import { api } from '@/services/api';
import type { AuthUser, DataEnvelope, LoginRequest, LoginResponse, MeResponse } from '@/services/types';

/** Logout should not keep the cashier waiting: local state is cleared regardless. */
const LOGOUT_TIMEOUT_MS = 8_000;

/** POST /api/v1/auth/login (Auth: no). */
export async function login(body: LoginRequest): Promise<LoginResponse> {
  const response = await api.post<DataEnvelope<LoginResponse>>('/api/v1/auth/login', body, { auth: false });
  return response.data;
}

/** GET /api/v1/auth/me (Auth: yes). */
export async function getMe(): Promise<AuthUser> {
  const response = await api.get<DataEnvelope<MeResponse>>('/api/v1/auth/me');
  return response.data;
}

/** POST /api/v1/auth/logout (Auth: yes). No body; 204. */
export async function logout(): Promise<void> {
  await api.post<void>('/api/v1/auth/logout', undefined, { timeoutMs: LOGOUT_TIMEOUT_MS });
}
