/**
 * Feature: Staff & Customers (Phase 1b): staff endpoints (permission
 * `user.manage`; the server answers 403 without it, or when the target's
 * role is above the caller's). One function per contract endpoint.
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  Role,
  RoleListParams,
  StaffCreateRequest,
  StaffListParams,
  StaffUpdateRequest,
  StaffUser,
} from '@/services/types';

const USERS = '/api/v1/admin/users';
const ROLES = '/api/v1/admin/roles';

/** GET /api/v1/admin/users: the caller's branch, deactivated users included. */
export async function listStaff(params: StaffListParams = {}): Promise<CursorPage<StaffUser>> {
  return api.get<CursorPage<StaffUser>>(
    `${USERS}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      search: params.search,
      role_id: params.role_id,
      is_active: params.is_active,
    })}`,
  );
}

/** GET /api/v1/admin/users/{id}. */
export async function getStaff(id: number): Promise<StaffUser> {
  const response = await api.get<DataEnvelope<StaffUser>>(`${USERS}/${id}`);
  return response.data;
}

/** POST /api/v1/admin/users → 201. */
export async function createStaff(body: StaffCreateRequest): Promise<StaffUser> {
  const response = await api.post<DataEnvelope<StaffUser>>(USERS, body);
  return response.data;
}

/** PATCH /api/v1/admin/users/{id}: partial (`name`, `email`, `role_id`, `is_active`). 409 on self-protection. */
export async function updateStaff(id: number, body: StaffUpdateRequest): Promise<StaffUser> {
  const response = await api.patch<DataEnvelope<StaffUser>>(`${USERS}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/users/{id} → 204 (soft delete). 409 when deleting yourself. */
export async function deleteStaff(id: number): Promise<void> {
  await api.delete<void>(`${USERS}/${id}`);
}

/** POST /api/v1/admin/users/{id}/password → 204. Revokes the target's tokens (your own current one is kept). */
export async function resetPassword(id: number, password: string): Promise<void> {
  await api.post<void>(`${USERS}/${id}/password`, { password });
}

/** PUT /api/v1/admin/users/{id}/pin: a 4–6 digit string, or `null` to remove the PIN. */
export async function setPin(id: number, pin: string | null): Promise<StaffUser> {
  const response = await api.put<DataEnvelope<StaffUser>>(`${USERS}/${id}/pin`, { pin });
  return response.data;
}

/** GET /api/v1/admin/roles: ordered by id; `assignable` says whether the caller may assign each role. */
export async function listRoles(params: RoleListParams = {}): Promise<CursorPage<Role>> {
  return api.get<CursorPage<Role>>(`${ROLES}${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`);
}
