/**
 * Staff and roles (Staff & Customers → Staff endpoints, permission
 * `user.manage`). Staff are always in the caller's branch; the server enforces
 * the role hierarchy (403 / 422 on `role_id`) and self-protection (409).
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  Role,
  RoleListParams,
  StaffCreateRequest,
  StaffListParams,
  StaffPasswordRequest,
  StaffPinRequest,
  StaffUpdateRequest,
  StaffUser,
} from '@/services/types';

const USERS = '/api/v1/admin/users';

/** GET /api/v1/admin/users: `search` (name or email), `role_id`, `is_active`; by name then id. */
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

/** PATCH /api/v1/admin/users/{id}: `name`, `email`, `role_id`, `is_active` (partial). */
export async function updateStaff(id: number, body: StaffUpdateRequest): Promise<StaffUser> {
  const response = await api.patch<DataEnvelope<StaffUser>>(`${USERS}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/users/{id} → 204 (soft delete). */
export async function deleteStaff(id: number): Promise<void> {
  await api.delete<void>(`${USERS}/${id}`);
}

/** POST /api/v1/admin/users/{id}/password → 204. Revokes the user's tokens. */
export async function resetStaffPassword(id: number, body: StaffPasswordRequest): Promise<void> {
  await api.post<void>(`${USERS}/${id}/password`, body);
}

/** PUT /api/v1/admin/users/{id}/pin: a 4–6 digit string, or `null` to remove it. */
export async function setStaffPin(id: number, body: StaffPinRequest): Promise<StaffUser> {
  const response = await api.put<DataEnvelope<StaffUser>>(`${USERS}/${id}/pin`, body);
  return response.data;
}

/** GET /api/v1/admin/roles: seeded roles with their permissions and `assignable`; by id. */
export async function listRoles(params: RoleListParams = {}): Promise<CursorPage<Role>> {
  return api.get<CursorPage<Role>>(`/api/v1/admin/roles${buildQuery({ per_page: params.per_page ?? 100, cursor: params.cursor })}`);
}
