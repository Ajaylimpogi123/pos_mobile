/**
 * Feature: Auth & Access Control (Phase 0), plus the PIN quick-switch
 * endpoints of Core Sale (Phase 3). One function per contract endpoint.
 * `GET /api/v1/admin/users` is backend-only in Phase 0 and deliberately not consumed here.
 */
import { api, buildQuery } from '@/services/api';
import type {
  AuthUser,
  CursorPage,
  DataEnvelope,
  LoginRequest,
  LoginResponse,
  MeResponse,
  PinLoginRequest,
  PinLoginResponse,
  PinUser,
  PinUserListParams,
} from '@/services/types';

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

/**
 * GET /api/v1/auth/pin-users (Auth: yes): active users of the caller's branch
 * who have a PIN (the caller included), by name. `per_page` defaults to 100.
 */
export async function listPinUsers(params: PinUserListParams = {}): Promise<CursorPage<PinUser>> {
  return api.get<CursorPage<PinUser>>(
    `/api/v1/auth/pin-users${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`,
  );
}

/**
 * POST /api/v1/auth/pin (Auth: yes, the device's current session). 200 is
 * exactly the login response for the **target** user; the server revokes the
 * token that made this request. 422 on `user_id` or `pin`, 429 while the PIN is locked.
 */
export async function pinLogin(body: PinLoginRequest): Promise<PinLoginResponse> {
  const response = await api.post<DataEnvelope<PinLoginResponse>>('/api/v1/auth/pin', body);
  return response.data;
}
