/**
 * Table Management (v1.29) §E/§F: reservations on the web terminal.
 *
 * - `useReservationList`: one business day's reservations (cursor list),
 *   polled like the Tables view so a booking taken on another device shows.
 * - `invalidateReservations`: after every reservation or seating action; the
 *   Tables view and the board reload too (a reservation holds its table).
 * - The writes reuse `useTabAction` (`hooks/useTab.ts`): one
 *   `Idempotency-Key` per action, kept on every retry until a 2xx; `422`s go
 *   under their fields, a `409` to the caller's dialog.
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useCursorList } from '@/hooks/useCursorList';
import { invalidateTables, TABLES_POLL_MS } from '@/hooks/useDiningTables';
import { listReservations } from '@/services/reservations';
import type { BusinessDate, ReservationStatus } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime, formatBranchTime } from '@pos/core/businessDay';

export const reservationKeys = {
  all: ['reservations'] as const,
  list: (date: BusinessDate, status: ReservationStatus | null) => ['reservations', 'list', date, status ?? 'all'] as const,
};

export function useReservationList(date: BusinessDate, options: { status?: ReservationStatus | null; enabled?: boolean } = {}) {
  const enabled = (options.enabled ?? true) && date !== '';
  const status = options.status ?? null;
  return useCursorList(
    reservationKeys.list(date, status),
    (cursor) => listReservations({ date, status: status ?? undefined, cursor, per_page: 100 }),
    { enabled, refetchInterval: enabled ? TABLES_POLL_MS : false },
  );
}

export function invalidateReservations(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
  invalidateTables(queryClient);
}

/** A callback that reloads the reservations, the Tables view and the board. */
export function useReservationRefresh() {
  const queryClient = useQueryClient();
  return () => invalidateReservations(queryClient);
}

/** §F: a `409` shows in a dialog; closing it reloads the reservations and the tables. */
export function useReservationConflict() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  return {
    message,
    show: (text: string) => setMessage(text),
    dismiss: () => {
      setMessage(null);
      invalidateReservations(queryClient);
    },
  };
}

export type ReservationConflict = ReturnType<typeof useReservationConflict>;

/** The branch's timezone and day start (reservation times are the branch's wall clock). */
export function useBranchClock() {
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const dayStart = useSessionStore((state) => state.user?.branch.day_start_time ?? '00:00');
  return {
    timeZone,
    dayStart,
    /** "7:00 PM" in the branch's timezone. */
    time: (iso: string) => formatBranchTime(iso, timeZone) ?? '',
    /** "26 Oct 2026, 7:00 PM". */
    dateTime: (iso: string) => formatBranchDateTime(iso, timeZone) ?? '',
  };
}
