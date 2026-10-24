import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useKeyedCursorList } from '@/hooks/useCursorList';
import { useNow } from '@/hooks/useNow';
import { getShift, listShifts } from '@/services/shifts';
import type { Shift } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { printServerShift, type PrintOutcome } from '@/shifts/shiftActions';
import { addBusinessDays, businessDateAt } from '@pos/core/businessDay';

/** TanStack Query keys for shifts. Everything lives under `['shifts']`. */
export const shiftKeys = {
  all: ['shifts'] as const,
  list: (businessDate: string | null) => ['shifts', 'list', businessDate] as const,
  detail: (ulid: string) => ['shifts', 'detail', ulid] as const,
};

export const SHIFT_PAGE_SIZE = 25;

const TODAY_REFRESH_MS = 60_000;

/** `null`: today (follows the business day); `'all'`: every date; else a `YYYY-MM-DD` label. */
export type ShiftDateSelection = null | 'all' | string;

function ulidOf(shift: Shift): string {
  return shift.ulid;
}

/**
 * The Shifts list (`report.zread`): `GET /shifts` for one business date
 * (today by default, a day at a time, never past today) or every date,
 * `opened_at` descending, with infinite scroll.
 */
export function useShiftListScreen() {
  const branch = useSessionStore((state) => state.user?.branch ?? null);
  const now = useNow(TODAY_REFRESH_MS);
  const today = branch ? businessDateAt(now, branch.timezone, branch.day_start_time) : null;
  const [selection, setSelection] = useState<ShiftDateSelection>(null);
  const businessDate = selection === 'all' ? null : (selection ?? today);

  const list = useKeyedCursorList({
    queryKey: shiftKeys.list(businessDate),
    fetchPage: (cursor) => listShifts({ per_page: SHIFT_PAGE_SIZE, cursor, business_date: businessDate ?? undefined }),
    keepPrevious: true,
    keyOf: ulidOf,
  });

  function step(days: number) {
    if (businessDate === null) return;
    const next = addBusinessDays(businessDate, days);
    if (today !== null && next >= today) setSelection(null);
    else setSelection(next);
  }

  return {
    today,
    businessDate,
    isToday: businessDate !== null && businessDate === today,
    allDates: selection === 'all',
    previousDay: () => step(-1),
    nextDay: () => step(1),
    canGoNext: businessDate !== null && today !== null && businessDate < today,
    showToday: () => setSelection(null),
    showAllDates: () => setSelection('all'),
    list,
  };
}

export type ShiftListScreenState = ReturnType<typeof useShiftListScreen>;

/** One shift (`GET /shifts/{ulid}`), with Print (X-read while open; a closed shift's Z-read prints as a reprint). */
export function useShiftDetail(ulid: string | null) {
  const user = useSessionStore((state) => state.user);
  const query = useQuery({
    queryKey: shiftKeys.detail(ulid ?? ''),
    queryFn: () => getShift(ulid as string),
    enabled: ulid !== null,
  });
  const [printing, setPrinting] = useState(false);
  const [print, setPrint] = useState<PrintOutcome | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function printShift() {
    if (!query.data || printing) return;
    setPrinting(true);
    const outcome = await printServerShift(query.data, user, Date.now());
    if (!mounted.current) return;
    setPrinting(false);
    setPrint(outcome);
  }

  return { query, printing, print, printShift: () => void printShift() };
}
