import type { SubNavLink } from '@/components/common/SubNav';

/** The Staff module's two pages: the staff list and the read-only roles. */
export const STAFF_NAV: readonly SubNavLink[] = [
  { to: '/staff', label: 'Staff' },
  { to: '/staff/roles', label: 'Roles' },
];
