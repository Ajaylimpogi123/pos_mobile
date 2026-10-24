/**
 * Staff and roles (Staff & Customers → Staff endpoints, `user.manage`).
 * The server enforces the hierarchy and self-protection; `can_manage` and
 * `assignable` are UI hints only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { getErrorMessage } from '@/services/api';
import { createStaff, deleteStaff, getStaff, listRoles, listStaff, resetStaffPassword, setStaffPin, updateStaff } from '@/services/staff';
import type { Role, StaffCreateRequest, StaffUpdateRequest, StaffUser } from '@/services/types';

export const staffKeys = {
  all: ['admin', 'staff'] as const,
  list: (search: string, roleId: number | null, isActive: boolean | null) => ['admin', 'staff', 'list', search, roleId, isActive] as const,
  detail: (id: number) => ['admin', 'staff', 'detail', id] as const,
  roles: ['admin', 'roles'] as const,
};

/** Contract limits and the password policy (Staff rules). */
export const STAFF_LIMITS = { name: 100, email: 255, passwordMin: 10, passwordMax: 255 } as const;

export const PASSWORD_POLICY_HINT = 'At least 10 characters, with upper- and lowercase letters and a number.';

/** `Password::min(10)->mixedCase()->numbers()`, max 255: the problem, or `null`. */
export function passwordProblem(password: string): string | null {
  if (password === '') return 'Enter a password.';
  if (password.length < STAFF_LIMITS.passwordMin) return `Use at least ${STAFF_LIMITS.passwordMin} characters.`;
  if (password.length > STAFF_LIMITS.passwordMax) return `Use ${STAFF_LIMITS.passwordMax} characters or fewer.`;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return 'Use both upper- and lowercase letters.';
  if (!/\d/.test(password)) return 'Include at least one number.';
  return null;
}

export const PIN_FORMAT_MESSAGE = 'Enter 4 to 6 digits.';

/** PIN format only (4–6 digits); the "not trivial" rule is the server's 422. */
export function isPinFormatValid(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/** Digits only, at most 6. */
export function sanitizePin(text: string): string {
  return text.replace(/\D/g, '').slice(0, 6);
}

export function useStaffList(search: string, roleId: number | null, isActive: boolean | null) {
  return useCursorList(staffKeys.list(search, roleId, isActive), (cursor) =>
    listStaff({ cursor, per_page: 25, search: search || undefined, role_id: roleId ?? undefined, is_active: isActive ?? undefined }),
  );
}

export function useStaffMember(id: number | null) {
  const query = useQuery({ queryKey: staffKeys.detail(id ?? 0), queryFn: () => getStaff(id as number), enabled: id !== null });
  return {
    staff: query.data ?? null,
    loading: id !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/** Every seeded role (one page of up to 100; the roles are few). */
export function useRoles() {
  const query = useQuery({ queryKey: staffKeys.roles, queryFn: async (): Promise<Role[]> => (await listRoles({ per_page: 100 })).data });
  return {
    roles: query.data ?? [],
    loading: query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

function useStaffCache() {
  const client = useQueryClient();
  return (saved?: StaffUser) => {
    if (saved) client.setQueryData(staffKeys.detail(saved.id), saved);
    void client.invalidateQueries({ queryKey: staffKeys.all });
  };
}

export function useCreateStaff() {
  const cache = useStaffCache();
  return useMutation({ mutationFn: (body: StaffCreateRequest) => createStaff(body), onSuccess: cache });
}

export function useUpdateStaff() {
  const cache = useStaffCache();
  return useMutation({ mutationFn: ({ id, body }: { id: number; body: StaffUpdateRequest }) => updateStaff(id, body), onSuccess: cache });
}

export function useDeleteStaff() {
  const cache = useStaffCache();
  return useMutation({ mutationFn: (id: number) => deleteStaff(id), onSuccess: () => cache() });
}

export function useResetStaffPassword() {
  return useMutation({ mutationFn: ({ id, password }: { id: number; password: string }) => resetStaffPassword(id, { password }) });
}

export function useSetStaffPin() {
  const cache = useStaffCache();
  return useMutation({ mutationFn: ({ id, pin }: { id: number; pin: string | null }) => setStaffPin(id, { pin }), onSuccess: cache });
}
