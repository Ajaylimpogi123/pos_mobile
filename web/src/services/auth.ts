/**
 * Auth & Access Control (unchanged endpoints, Web POS §B). One function per endpoint.
 */
import { api, buildQuery } from '@/services/api';
import type { AuthUser, CursorPage, CursorParams, DataEnvelope, LoginRequest, LoginResponse, PinUser } from '@/services/types';

const LOGOUT_TIMEOUT_MS = 8_000;

/** POST /api/v1/auth/login (Auth: no). A 401 here is the form's "Invalid email or password." */
export async function login(body: LoginRequest): Promise<LoginResponse> {
  const response = await api.post<DataEnvelope<LoginResponse>>('/api/v1/auth/login', body, { auth: false });
  return response.data;
}

/** GET /api/v1/auth/me. */
export async function getMe(): Promise<AuthUser> {
  const response = await api.get<DataEnvelope<AuthUser>>('/api/v1/auth/me');
  return response.data;
}

/** POST /api/v1/auth/logout → 204. Revokes only the current token. */
export async function logout(): Promise<void> {
  await api.post<void>('/api/v1/auth/logout', undefined, { timeoutMs: LOGOUT_TIMEOUT_MS });
}

/** GET /api/v1/auth/pin-users: active users of the branch with a PIN (per_page default 100). */
export async function listPinUsers(params: CursorParams = {}): Promise<CursorPage<PinUser>> {
  return api.get<CursorPage<PinUser>>(`/api/v1/auth/pin-users${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`);
}
