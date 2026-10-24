import type { SubNavLink } from '@/components/common/SubNav';

/** The Ingredients module's two pages: the ingredients and the (read-only) unit catalog. */
export const INGREDIENTS_NAV: readonly SubNavLink[] = [
  { to: '/ingredients', label: 'Ingredients' },
  { to: '/ingredients/units', label: 'Units' },
];
