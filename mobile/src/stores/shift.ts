import { create } from 'zustand';

import type { LocalShift } from '@/db/shiftRepository';

/**
 * This tablet's shift for the screens (docs/api-contract.md → Shifts &
 * Reporting → Device rules → Shift gate). Pure state + setters: the shift
 * lives in SQLite (`@/db/shiftRepository`), the work in `@/shifts/shiftActions`.
 */
export type ShiftLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** What the last close printed (shown on the "Open a shift" gate). */
export type LastClose = {
  shiftUlid: string;
  /** The Z-read print jobs. */
  jobIds: string[];
  /** Why the Z-read couldn't print (no receipt printer, Expo Go, …), or `null`. */
  notice: string | null;
};

type ShiftState = {
  status: ShiftLoadStatus;
  /** The branch the loaded shift belongs to. */
  branchId: number | null;
  /** The open shift, or `null` (sales need one). */
  current: LocalShift | null;
  error: string | null;
  /** A message for the gate, e.g. the server's "This shift is closed. Open a new shift." */
  gateNotice: string | null;
  lastClose: LastClose | null;

  startLoading: (branchId: number) => void;
  setLoaded: (branchId: number, shift: LocalShift | null) => void;
  setError: (branchId: number, message: string) => void;
  setCurrent: (shift: LocalShift | null) => void;
  setGateNotice: (message: string | null) => void;
  setLastClose: (close: LastClose | null) => void;
  /** Test helper: back to the initial state. */
  reset: () => void;
};

const initialState = {
  status: 'idle' as ShiftLoadStatus,
  branchId: null,
  current: null,
  error: null,
  gateNotice: null,
  lastClose: null,
};

export const useShiftStore = create<ShiftState>()((set) => ({
  ...initialState,
  startLoading: (branchId) =>
    set((state) => ({
      status: state.branchId === branchId && state.status === 'ready' ? 'ready' : 'loading',
      branchId,
      error: null,
    })),
  setLoaded: (branchId, shift) =>
    set((state) => {
      // A re-read that found the same shift keeps the same object: screens don't re-render for nothing.
      const same = state.current !== null && shift !== null && JSON.stringify(state.current) === JSON.stringify(shift);
      if (same && state.status === 'ready' && state.branchId === branchId && state.error === null) return state;
      return { status: 'ready', branchId, current: same ? state.current : shift, error: null };
    }),
  setError: (branchId, message) => set({ status: 'error', branchId, current: null, error: message }),
  setCurrent: (current) => set({ current }),
  setGateNotice: (gateNotice) => set({ gateNotice }),
  setLastClose: (lastClose) => set({ lastClose }),
  reset: () => set(initialState),
}));
