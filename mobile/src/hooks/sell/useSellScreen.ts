import { useCallback, useState } from 'react';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useOfflineMenu } from '@/hooks/useOfflineMenu';
import { useSyncState, type SyncState } from '@/hooks/sync/useSyncState';
import { requestCatalogueSync } from '@/sync/catalogueSync';
import { requestOutboxSync } from '@/sync/outboxSync';
import { requestPrintConfigSync } from '@/sync/printConfigSync';
import { requestStockSync } from '@/sync/stockSync';

/** Local (SQLite) searches wait this long after the last keystroke. */
export const LOCAL_SEARCH_DEBOUNCE_MS = 150;

/** The unified sync state (see `useSyncState`). */
export type SellSyncState = SyncState;

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

  // A selected category that a sync removed (deleted or inactive) falls back to "All".
  // Adjusted during render (React's "adjusting state when a prop changes" pattern), not in an effect.
  const categoryVisible = categoryId === null || menu.categories.some((category) => category.id === categoryId);
  if (!menu.loading && menu.error === null && !categoryVisible) setCategoryId(null);

  const sync: SellSyncState = useSyncState(menu.serverTime);

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
