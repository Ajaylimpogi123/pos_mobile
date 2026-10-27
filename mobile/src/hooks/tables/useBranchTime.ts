import { useCallback } from 'react';

import { useSessionStore } from '@/stores/session';
import { businessDateAt, formatBranchTime } from '@pos/core/businessDay';

/**
 * The branch clock for reservations (Table Management §E): its timezone, its
 * business "today", and a reservation's time as "7:00 PM" in that zone.
 */
export function useBranchTime() {
  const timeZone = useSessionStore((state) => state.user?.branch?.timezone ?? '');
  const dayStart = useSessionStore((state) => state.user?.branch?.day_start_time ?? '00:00');

  const today = useCallback(() => businessDateAt(Date.now(), timeZone, dayStart), [timeZone, dayStart]);
  const time = useCallback((iso: string) => formatBranchTime(iso, timeZone) ?? '', [timeZone]);

  return { timeZone, today, time };
}
