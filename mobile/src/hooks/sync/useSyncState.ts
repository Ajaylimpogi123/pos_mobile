import { useMemo } from 'react';

import { useIsOnline } from '@/hooks/useIsOnline';
import { useNow } from '@/hooks/useNow';
import { useConnectivityStore } from '@/stores/connectivity';
import { useOfflineStore } from '@/stores/offline';
import { useSyncStore, type SyncStatus } from '@/stores/sync';
import { formatSyncedAgo } from '@/utils/dates';

/** How often "Synced N min ago" is refreshed. */
const SYNCED_LABEL_REFRESH_MS = 30_000;

export type SyncState = {
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
 * The unified sync state (catalogue sync + offline sales outbox + the
 * connection), for the Sell status pill and the header sync badge on every
 * screen (MASTER §2.2). `fallbackServerTime`: the menu's stored sync time,
 * used before this launch's first sync has run.
 */
export function useSyncState(fallbackServerTime: string | null = null): SyncState {
  const status = useSyncStore((state) => state.status);
  const syncError = useSyncStore((state) => state.error);
  const storeServerTime = useSyncStore((state) => state.lastServerTime);
  const now = useNow(SYNCED_LABEL_REFRESH_MS);
  const online = useIsOnline();
  const serverReachable = useConnectivityStore((state) => state.serverReachable);
  const pending = useOfflineStore((state) => state.pending);
  const needsAttention = useOfflineStore((state) => state.needsAttention);
  const outboxSyncing = useOfflineStore((state) => state.syncing);

  const serverTime = storeServerTime ?? fallbackServerTime;
  return useMemo(
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
}
