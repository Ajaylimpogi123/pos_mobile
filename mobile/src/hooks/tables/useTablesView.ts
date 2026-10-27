import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';

import { groupByArea } from '@/components/tables/tableLabels';
import { tabRoute } from '@/constants/routes';
import { tableKeys } from '@/hooks/tables/queryKeys';
import { useReservationActions } from '@/hooks/tables/useReservationActions';
import { useIsOnline } from '@/hooks/useIsOnline';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { listTables, openTab } from '@/services/tables';
import type { TableView } from '@/services/types';
import { requestPrintConfigSync } from '@/sync/printConfigSync';
import { ulid as makeUlid } from '@/utils/ulid';
import { tableStatus } from '@pos/core/tables/status';

/** §C: the clients poll every 15 seconds while the view is open. */
export const TABLES_POLL_MS = 15_000;

/** The guests a tab can have (§D.1). */
export const GUESTS_LIMITS = { min: 1, max: 99 } as const;

/** Safety cap on pages read at once (100 tables a page). */
const MAX_PAGES = 10;

export const DINE_IN_OFF_MESSAGE = 'Dine-in tables are turned off in Settings.';

/** Sell's **Pay now | Tables** switch. Kept in memory so coming back from a tab shows the tables again. */
export type SellMode = 'pay' | 'tables';

export const useSellModeStore = create<{ mode: SellMode; setMode: (mode: SellMode) => void }>()((set) => ({
  mode: 'pay',
  setMode: (mode) => set({ mode }),
}));

/** GET /api/v1/tables, every page (the active tables in the admin order). */
export async function fetchAllTables(): Promise<TableView[]> {
  const rows: TableView[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listTables({ cursor, per_page: 100 });
    rows.push(...result.data);
    if (!result.meta.next_cursor) break;
    cursor = result.meta.next_cursor;
  }
  return rows;
}

/** A `409` that means dine-in was turned off: the print config is synced so Sell drops the switch. */
export function isDineInOff(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.message.trim() === DINE_IN_OFF_MESSAGE;
}

export type OpenTabDraft = {
  table: TableView;
  guests: number;
  /** The `Idempotency-Key` (and `ulid`), made when the dialog opens and kept until a 201. */
  key: string;
  error: string | null;
};

/**
 * The Tables view on Sell (Dine-in Tables & Tabs §C and §I): the active
 * tables with their open bills, grouped by area, polled every 15 s while the
 * view is on screen and online, and the **Open bill** dialog (guests) for a
 * free table. An occupied table opens its tab. Offline: `Tables need a
 * connection.`, and nothing can be opened.
 *
 * Table Management (TM2): a **reserved** table (no tab, its reservation held)
 * opens the reserved sheet instead: Seat now, Cancel, No-show.
 */
export function useTablesView(active: boolean) {
  const client = useQueryClient();
  const online = useIsOnline();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const polling = active && focused && online;

  const query = useQuery({
    queryKey: tableKeys.tablesView(),
    queryFn: fetchAllTables,
    enabled: active && online,
    refetchInterval: polling ? TABLES_POLL_MS : false,
    refetchOnMount: 'always',
  });
  const tables = useMemo(() => query.data ?? [], [query.data]);
  const groups = useMemo(() => groupByArea(tables), [tables]);
  const dineInOff = isDineInOff(query.error);
  useEffect(() => {
    if (dineInOff) void requestPrintConfigSync();
  }, [dineInOff]);

  const [draft, setDraft] = useState<OpenTabDraft | null>(null);
  const [reservedId, setReservedId] = useState<number | null>(null);
  const reservations = useReservationActions();
  // The sheet follows the polled table, and closes when it is no longer reserved.
  const reserved = useMemo(() => {
    const table = reservedId === null ? null : (tables.find((row) => row.id === reservedId) ?? null);
    return table && tableStatus(table) === 'reserved' ? table : null;
  }, [reservedId, tables]);
  const [opening, setOpening] = useState(false);
  const inFlight = useRef(false);

  function refresh() {
    void client.invalidateQueries({ queryKey: tableKeys.tablesView() });
  }

  async function open() {
    if (!draft || inFlight.current) return;
    inFlight.current = true;
    setOpening(true);
    setDraft((current) => (current ? { ...current, error: null } : current));
    try {
      const tab = await openTab({ ulid: draft.key, table_id: draft.table.id, guests: draft.guests });
      client.setQueryData(tableKeys.tab(tab.ulid), tab);
      refresh();
      setDraft(null);
      router.push(tabRoute(tab.ulid));
    } catch (error) {
      let message = getErrorMessage(error);
      if (isApiValidationError(error)) message = error.firstError('guests') ?? error.firstError('table_id') ?? error.message;
      // A network error keeps the key: a retry may find the tab the first attempt opened.
      if (isApiError(error) && error.status === 409) refresh();
      setDraft((current) => (current ? { ...current, error: message } : current));
    } finally {
      inFlight.current = false;
      setOpening(false);
    }
  }

  return {
    online,
    tables,
    groups,
    loading: query.isPending && online && active,
    error: query.error,
    dineInOff,
    refreshing: query.isRefetching,
    refetch: () => query.refetch(),
    draft,
    opening,
    reserved,
    reservations,
    closeReserved: () => {
      setReservedId(null);
      reservations.clearSeatError();
    },
    /** A table card was tapped: a free table asks for guests; an occupied one opens its tab; a reserved one opens its sheet. */
    press: (table: TableView) => {
      if (!online) return;
      if (table.tab) router.push(tabRoute(table.tab.ulid));
      else if (tableStatus(table) === 'reserved') {
        reservations.clearSeatError();
        setReservedId(table.id);
      } else setDraft({ table, guests: Math.min(GUESTS_LIMITS.max, Math.max(GUESTS_LIMITS.min, table.seats)), key: makeUlid(), error: null });
    },
    setGuests: (guests: number) => setDraft((current) => (current ? { ...current, guests, error: null } : current)),
    confirmOpen: () => void open(),
    cancelOpen: () => {
      if (!inFlight.current) setDraft(null);
    },
  };
}

export type TablesViewState = ReturnType<typeof useTablesView>;
