import { useCallback, useEffect } from 'react';

import type { LocalShift } from '@/db/shiftRepository';
import { useSessionStore } from '@/stores/session';
import { useShiftStore } from '@/stores/shift';
import { loadCurrentShift } from '@/shifts/shiftActions';

export type CurrentShiftState = {
  /** Still reading SQLite (the gate waits instead of flashing "Open a shift"). */
  loading: boolean;
  /** SQLite couldn't be read. */
  error: string | null;
  /** This tablet's open shift for the signed-in branch, or `null`. */
  shift: LocalShift | null;
  reload: () => void;
};

/**
 * This tablet's open shift (docs/api-contract.md → Shifts & Reporting →
 * Shift gate), re-read from SQLite whenever a screen using it mounts, so it
 * is never stale. Sales need an open shift.
 */
export function useCurrentShift(): CurrentShiftState {
  const branchId = useSessionStore((state) => state.user?.branch.id ?? null);
  const status = useShiftStore((state) => state.status);
  const storedBranch = useShiftStore((state) => state.branchId);
  const current = useShiftStore((state) => state.current);
  const error = useShiftStore((state) => state.error);

  const reload = useCallback(() => {
    if (branchId !== null) void loadCurrentShift(branchId);
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const matches = branchId !== null && storedBranch === branchId;
  return {
    loading: branchId !== null && (!matches || status === 'idle' || status === 'loading'),
    error: matches && status === 'error' ? error : null,
    shift: matches && status === 'ready' ? current : null,
    reload,
  };
}
