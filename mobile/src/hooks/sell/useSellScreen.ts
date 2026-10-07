import { useCallback, useMemo, useState } from 'react';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useNow } from '@/hooks/useNow';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useOfflineMenu } from '@/hooks/useOfflineMenu';
import { useConnectivityStore } from '@/stores/connectivity';
import { useOfflineStore } from '@/stores/offline';
import { useSyncStore, type SyncStatus } from '@/stores/sync';
import { requestCatalogueSync } from '@/sync/catalogueSync';
import { requestOutboxSync } from '@/sync/outboxSync';
import { requestPrintConfigSync } from '@/sync/printConfigSync';
import { requestStockSync } from '@/sync/stockSync';
import { formatSyncedAgo } from '@/utils/dates';

/** Local (SQLite) searches wait this long after the last keystroke. */
export const LOCAL_SEARCH_DEBOUNCE_MS = 150;

/** How often "Synced N min ago" is refreshed. */
const SYNCED_LABEL_REFRESH_MS = 30_000;

export type SellSyncState = {
  status: SyncStatus;
  /** Error message while `status === 'error'`. */
  error: string | null;
  /** "Synced 5 min ago", or `null` before the first sync. */
  syncedLabel: string | null;
  syncing: boolean;
  /** Offline Sales (Phase 5): the device has a network connection (expo-network). */
  online: boolean;
  /** Offline Sales hardening: the server answered the last request (the circuit breaker). */
  serverReachable: boolean;
  /** Offline sales waiting to be sent. */
  pending: number;
  /** Offline sales the server rejected (kept, with Retry). */
  needsAttention: number;
  /** The outbox worker is sending. */
  outboxSyncing: boolean;
};

/**
 * State for the Sell screen (Phase 2, read-only). It lives above every layout
 * switch, so rotating keeps the search text and the selected category.
 * - Search (debounced) and the category filter, applied in SQLite.
 * - A selected category that disappears after a sync (deleted or inactive)
 *   falls back to "All".
 * - Sync status for the header, "Sync now", and pull-to-refresh (both run a
 *   catalogue sync, or join the one in progress). Phase 5 adds the offline
 *   sales to the status (the unified pill) and to "Sync now".
 */
export function useSellScreen() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const debouncedSearch = useDebouncedValue(search, LOCAL_SEARCH_DEBOUNCE_MS);

  const menu = useOfflineMenu({ categoryId, search: debouncedSearch });

  const status = useSyncStore((state) => state.status);
  const syncError = useSyncStore((state) => state.error);
  const storeServerTime = useSyncStore((state) => state.lastServerTime);
  const now = useNow(SYNCED_LABEL_REFRESH_MS);
  const online = useIsOnline();
  const serverReachable = useConnectivityStore((state) => state.serverReachable);
  const pending = useOfflineStore((state) => state.pending);
  const needsAttention = useOfflineStore((state) => state.needsAttention);
  const outboxSyncing = useOfflineStore((state) => state.syncing);

  // A selected category that a sync removed (deleted or inactive) falls back to "All".
  // Adjusted during render (React's "adjusting state when a prop changes" pattern), not in an effect.
  const categoryVisible = categoryId === null || menu.categories.some((category) => category.id === categoryId);
  if (!menu.loading && menu.error === null && !categoryVisible) setCategoryId(null);

  const serverTime = storeServerTime ?? menu.serverTime;
  const sync: SellSyncState = useMemo(
    () => ({
      status,
      error: status === 'error' ? syncError : null,
      syncedLabel: serverTime ? formatSyncedAgo(serverTime, now) : null,
      syncing: status === 'syncing',
      online,
      serverReachable,
      pending,
      needsAttention,
      outboxSyncing,
    }),
    [status, syncError, serverTime, now, online, serverReachable, pending, needsAttention, outboxSyncing],
  );

  // "Sync now" also refreshes the print config (Printing, Phase 4), sends the offline sales
  // at once (even while backing off) and refreshes the stock cache (Offline Sales, Phase 5).
  const syncNow = useCallback(() => {
    void requestCatalogueSync();
    void requestPrintConfigSync();
    void requestOutboxSync({ force: true });
    void requestStockSync();
  }, []);

  const refresh = useCallback(() => requestCatalogueSync(), []);

  return {
    search,
    setSearch,
    /** The debounced search is still catching up with the typed text. */
    searching: search.trim() !== debouncedSearch.trim(),
    clearSearch: () => setSearch(''),
    filtersActive: debouncedSearch.trim() !== '' || categoryId !== null,
    categoryId,
    setCategoryId,
    menu,
    sync,
    syncNow,
    refresh,
  };
}

export type SellScreenState = ReturnType<typeof useSellScreen>;
