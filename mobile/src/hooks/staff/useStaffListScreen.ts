import { useMemo, useState } from 'react';

import type { StaffListFilters, StaffStatusFilter } from '@/hooks/staff/queryKeys';
import { useRoles, useStaffList } from '@/hooks/staff/useStaff';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';

/**
 * State for the staff list: search (300 ms debounce), a role filter (chips
 * from GET /api/v1/admin/roles), Active / Inactive / All, and the infinite list.
 */
export function useStaffListScreen() {
  const [search, setSearch] = useState('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [status, setStatus] = useState<StaffStatusFilter>('all');

  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const filters = useMemo<StaffListFilters>(
    () => ({ search: debouncedSearch, roleId, status }),
    [debouncedSearch, roleId, status],
  );

  const list = useStaffList(filters);
  const roles = useRoles();

  function clearFilters() {
    setSearch('');
    setRoleId(null);
    setStatus('all');
  }

  return {
    search,
    setSearch,
    searching: search.trim() !== debouncedSearch || list.grid.updating,
    roleId,
    setRoleId,
    status,
    setStatus,
    filtersActive: filters.search !== '' || roleId !== null || status !== 'all',
    clearFilters,
    list,
    roles: roles.roles,
  };
}
