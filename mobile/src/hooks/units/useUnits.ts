import { useQuery } from '@tanstack/react-query';

import { unitKeys } from '@/hooks/purchasing/queryKeys';
import { listUnits } from '@/services/units';
import type { Unit } from '@/services/types';

/** The unit catalog changes only with a seeder: keep it for the session once loaded. */
const UNITS_STALE_MS = Infinity;

const NO_UNITS: readonly Unit[] = [];

/**
 * GET /api/v1/units, cached for the session. `units` is empty until it loads
 * (the pickers still offer the item's base unit and own units meanwhile).
 */
export function useUnits(enabled = true) {
  const query = useQuery({
    queryKey: unitKeys.all,
    queryFn: listUnits,
    staleTime: UNITS_STALE_MS,
    enabled,
  });
  return { ...query, units: query.data ?? NO_UNITS };
}
