/**
 * TanStack Query keys for staff management. Everything lives under
 * `['admin', 'staff']`, so one invalidation refreshes lists and details.
 */
export type StaffStatusFilter = 'all' | 'active' | 'inactive';

export type StaffListFilters = {
  /** Trimmed, debounced search text ('' = no filter). */
  search: string;
  roleId: number | null;
  status: StaffStatusFilter;
};

const root = ['admin', 'staff'] as const;

export const staffKeys = {
  all: root,
  lists: () => [...root, 'list'] as const,
  list: (filters: StaffListFilters) => [...root, 'list', filters] as const,
  detail: (id: number) => [...root, 'detail', id] as const,
  roles: () => ['admin', 'roles'] as const,
};
