import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { tableKeys } from '@/hooks/tables/queryKeys';
import { useBranchTime } from '@/hooks/tables/useBranchTime';
import { useDayReservations } from '@/hooks/tables/useReservations';
import { fetchAllTables, isDineInOff, TABLES_POLL_MS } from '@/hooks/tables/useTablesView';
import { useIsOnline } from '@/hooks/useIsOnline';
import { getTablesSummary } from '@/services/tables';
import type { TableView } from '@/services/types';
import { requestPrintConfigSync } from '@/sync/printConfigSync';
import { tableStatus } from '@pos/core/tables/status';

/** The board's sortable columns (§D). */
export type BoardSortKey = 'table' | 'status' | 'guests' | 'opened_by' | 'open' | 'last_round' | 'unpaid';
export type SortDirection = 'asc' | 'desc';

export const BOARD_SORT_LABELS: Record<BoardSortKey, string> = {
  table: 'Table',
  status: 'Status',
  guests: 'Guests',
  opened_by: 'Opened by',
  open: 'Time open',
  last_round: 'Last round',
  unpaid: 'Unpaid',
};

const STATUS_ORDER = { occupied: 0, reserved: 1, free: 2 } as const;

/** A number or text to sort by; `null` (free tables for tab columns) always sorts last. */
function sortValue(table: TableView, key: BoardSortKey): number | string | null {
  const tab = table.tab;
  switch (key) {
    case 'table':
      return `${table.area ?? ''}\u0000${table.name}`;
    case 'status':
      return STATUS_ORDER[tableStatus(table)];
    case 'guests':
      return tab ? tab.guests : null;
    case 'opened_by':
      return tab ? tab.opened_by.name : null;
    case 'open':
      // Oldest first = the longest open first.
      return tab ? Date.parse(tab.opened_at) : null;
    case 'last_round':
      return tab?.last_round_at ? Date.parse(tab.last_round_at) : null;
    case 'unpaid':
      return tab ? tab.remaining_cents : null;
  }
}

/**
 * The board's table list, sorted (§D). "Time open" and "Last round" sort by
 * their timestamps, so ascending is the oldest (longest) first. Rows without
 * a value (free tables) stay last in both directions; ties keep the server's order.
 */
export function sortBoardRows(rows: readonly TableView[], key: BoardSortKey, direction: SortDirection): TableView[] {
  const sign = direction === 'asc' ? 1 : -1;
  return rows
    .map((table, index) => ({ table, index, value: sortValue(table, key) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      let order = 0;
      if (typeof a.value === 'number' && typeof b.value === 'number') order = a.value - b.value;
      else order = String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: 'base' });
      return order !== 0 ? sign * order : a.index - b.index;
    })
    .map((entry) => entry.table);
}

/** The rows with a bill that still has something to pay. */
export function unpaidOnly(rows: readonly TableView[]): TableView[] {
  return rows.filter((table) => table.tab !== null && table.tab.remaining_cents > 0);
}

/**
 * Tables → **Board** (Table Management §D; `report.view`): `GET
 * /tables/summary` for the stat cards and `GET /tables` for the list, both
 * polled every 15 s while on screen and online, sorted by any column (time
 * open, oldest first, by default) with an **Unpaid only** filter, and today's
 * booked reservations (`GET /reservations` reads with `report.view`, Q-051).
 * `409` while dine-in is off.
 */
export function useTablesBoard(active: boolean) {
  const online = useIsOnline();
  const { today } = useBranchTime();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const live = active && online;
  const polling = live && focused;

  const summary = useQuery({
    queryKey: tableKeys.summary(),
    queryFn: getTablesSummary,
    enabled: live,
    refetchInterval: polling ? TABLES_POLL_MS : false,
    refetchOnMount: 'always',
  });
  const dineInOff = isDineInOff(summary.error);
  const tablesQuery = useQuery({
    queryKey: tableKeys.tablesView(),
    queryFn: fetchAllTables,
    enabled: live && !dineInOff,
    refetchInterval: polling ? TABLES_POLL_MS : false,
    refetchOnMount: 'always',
  });
  const upcoming = useDayReservations(today(), live && !dineInOff, 'booked');

  useEffect(() => {
    if (dineInOff) void requestPrintConfigSync();
  }, [dineInOff]);

  const [sortKey, setSortKey] = useState<BoardSortKey>('open');
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [unpaid, setUnpaid] = useState(false);

  const rows = useMemo(() => {
    const all = tablesQuery.data ?? [];
    return sortBoardRows(unpaid ? unpaidOnly(all) : all, sortKey, direction);
  }, [tablesQuery.data, unpaid, sortKey, direction]);

  return {
    online,
    summary,
    tablesQuery,
    upcoming,
    dineInOff,
    rows,
    sortKey,
    direction,
    unpaid,
    /** Tapping the current column flips the direction; another column starts ascending. */
    sortBy: (key: BoardSortKey) => {
      if (key === sortKey) setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      else {
        setSortKey(key);
        setDirection('asc');
      }
    },
    toggleUnpaid: () => setUnpaid((current) => !current),
    refetch: () => Promise.all([summary.refetch(), tablesQuery.refetch(), upcoming.refetch()]),
  };
}

export type TablesBoardState = ReturnType<typeof useTablesBoard>;
