import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { staffKeys, type StaffListFilters } from '@/hooks/staff/queryKeys';
import { useCursorList } from '@/hooks/useCursorList';
import {
  createStaff,
  deleteStaff,
  getStaff,
  listRoles,
  listStaff,
  resetPassword,
  setPin,
  updateStaff,
} from '@/services/adminStaff';
import type { StaffUpdateRequest, StaffUser } from '@/services/types';

/** Staff per page on the list. */
export const STAFF_PAGE_SIZE = 25;
/** Roles: the contract's default and maximum page size. */
export const ROLES_PAGE_SIZE = 100;

/** GET /api/v1/admin/users with the list filters (search, role, active/inactive). */
export function useStaffList(filters: StaffListFilters) {
  return useCursorList({
    queryKey: staffKeys.list(filters),
    fetchPage: (cursor) =>
      listStaff({
        per_page: STAFF_PAGE_SIZE,
        cursor,
        search: filters.search === '' ? undefined : filters.search,
        role_id: filters.roleId ?? undefined,
        is_active: filters.status === 'all' ? undefined : filters.status === 'active',
      }),
    keepPrevious: true,
  });
}

/** GET /api/v1/admin/users/{id}. */
export function useStaffMember(id: number | null) {
  return useQuery({
    queryKey: staffKeys.detail(id ?? -1),
    queryFn: () => getStaff(id as number),
    enabled: id !== null,
  });
}

/** Every role (GET /api/v1/admin/roles, following `next_cursor`), plus the ones the caller may assign. */
export function useRoles() {
  const list = useCursorList({
    queryKey: staffKeys.roles(),
    fetchPage: (cursor) => listRoles({ per_page: ROLES_PAGE_SIZE, cursor }),
    fetchAll: true,
  });
  const assignable = useMemo(() => list.items.filter((role) => role.assignable), [list.items]);
  return { ...list, roles: list.items, assignable };
}

/**
 * Staff mutations. Each one writes the returned user into the detail cache
 * (when there is one) and invalidates every staff query.
 */
export function useStaffMutations() {
  const client = useQueryClient();

  function afterSave(user: StaffUser) {
    client.setQueryData(staffKeys.detail(user.id), user);
    void client.invalidateQueries({ queryKey: staffKeys.all });
  }

  function invalidate() {
    void client.invalidateQueries({ queryKey: staffKeys.all });
  }

  const create = useMutation({ mutationFn: createStaff, onSuccess: afterSave });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: StaffUpdateRequest }) => updateStaff(id, body),
    onSuccess: afterSave,
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteStaff(id),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: staffKeys.detail(id) });
      invalidate();
    },
  });

  const password = useMutation({
    mutationFn: ({ id, password: value }: { id: number; password: string }) => resetPassword(id, value),
    onSuccess: invalidate,
  });

  const pin = useMutation({
    mutationFn: ({ id, pin: value }: { id: number; pin: string | null }) => setPin(id, value),
    onSuccess: afterSave,
  });

  return { create, update, remove, password, pin };
}
