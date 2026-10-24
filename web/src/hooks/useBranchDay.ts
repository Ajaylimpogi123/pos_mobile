/**
 * The signed-in branch and its current business day (`YYYY-MM-DD`, from the
 * branch timezone and day start through `@pos/core/businessDay`). Read once
 * when the page opens, like the Shifts and Orders pages do.
 */
import { useState } from 'react';

import { useSessionStore } from '@/stores/session';
import { businessDateAt } from '@pos/core/businessDay';

export function useBranchDay(): { branchName: string | null; today: string } {
  const user = useSessionStore((state) => state.user);
  const [today] = useState(() => (user ? businessDateAt(Date.now(), user.branch.timezone, user.branch.day_start_time) : ''));
  return { branchName: user?.branch.name ?? null, today };
}
