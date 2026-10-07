import { useCallback, useEffect, useRef, useState } from 'react';

import { prepareDatabase } from '@/db/database';
import { offlineRepository, type LocalOrderRecord, type ShiftEventRecord } from '@/db/offlineRepository';
import { useIsOnline } from '@/hooks/useIsOnline';
import { isoSeconds } from '@/sale/localOrder';
import { useOfflineStore } from '@/stores/offline';
import { refreshOutboxCounts, requestOutboxSync } from '@/sync/outboxSync';

export const QUEUE_STORAGE_MESSAGE = "The sales saved on this tablet couldn't be read. Restart the app and try again.";

/** One card of the Sync queue: a sale, or (Phase 6) a shift event. */
export type SyncQueueEntry =
  | { kind: 'sale'; key: string; status: LocalOrderRecord['status']; createdAt: string; record: LocalOrderRecord }
  | { kind: 'shift'; key: string; status: ShiftEventRecord['status']; createdAt: string; event: ShiftEventRecord };

/** Loads the unsynced sales and shift events stored on this tablet, newest first. */
async function readQueue(): Promise<SyncQueueEntry[]> {
  if (!(await prepareDatabase())) throw new Error(QUEUE_STORAGE_MESSAGE);
  const sales = await offlineRepository.listLocalOrders({ statuses: ['pending', 'needs_attention'] });
  const events = await offlineRepository.listShiftEvents();
  const entries: SyncQueueEntry[] = [
    ...sales.map((record) => ({ kind: 'sale' as const, key: record.ulid, status: record.status, createdAt: record.createdAt, record })),
    ...events.map((event) => ({ kind: 'shift' as const, key: event.ulid, status: event.status, createdAt: event.createdAt, event })),
  ];
  // Newest first; a tie keeps sales before shift events.
  return entries.sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * The Sync queue (docs/api-contract.md → Offline Sales → Status pill): the
 * sales (and, Phase 6, the shift events: open, cash in / out, close) saved on
 * this tablet that are still **pending** or **need attention**
 * (the server rejected them; they are never deleted), with **Sync now** and a
 * per-sale **Retry** that puts a rejected sale back in the queue. The list
 * re-reads SQLite whenever the outbox changes; pull-to-refresh re-reads it and
 * asks the worker to send.
 */
export function useSyncQueue() {
  const online = useIsOnline();
  const localVersion = useOfflineStore((state) => state.localVersion);
  const syncing = useOfflineStore((state) => state.syncing);
  const lastError = useOfflineStore((state) => state.lastError);

  const [items, setItems] = useState<SyncQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const mounted = useRef(true);

  const apply = useCallback((outcome: { rows: SyncQueueEntry[] } | { error: unknown }) => {
    if (!mounted.current) return;
    if ('rows' in outcome) {
      setItems(outcome.rows);
      setError(null);
    } else {
      setError(outcome.error instanceof Error ? outcome.error : new Error(QUEUE_STORAGE_MESSAGE));
    }
    setLoading(false);
  }, []);

  const load = useCallback(
    () =>
      readQueue().then(
        (rows) => apply({ rows }),
        (caught: unknown) => apply({ error: caught }),
      ),
    [apply],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Read again whenever the outbox changes (a sale saved, sent, rejected or re-queued).
  useEffect(() => {
    let active = true;
    readQueue().then(
      (rows) => {
        if (active) apply({ rows });
      },
      (caught: unknown) => {
        if (active) apply({ error: caught });
      },
    );
    return () => {
      active = false;
    };
  }, [apply, localVersion]);

  const syncNow = useCallback(() => {
    void requestOutboxSync({ force: true });
  }, []);

  const retry = useCallback(async (ulid: string) => {
    setRetrying((current) => ({ ...current, [ulid]: true }));
    try {
      if (await offlineRepository.requeue(ulid, isoSeconds(Date.now()))) {
        useOfflineStore.getState().markLocalChanged();
        await refreshOutboxCounts();
        void requestOutboxSync({ force: true });
      }
    } catch {
      // It stays in "needs attention" with its Retry.
    } finally {
      if (mounted.current) setRetrying((current) => ({ ...current, [ulid]: false }));
    }
  }, []);

  return {
    items,
    online,
    syncing,
    lastError,
    pendingCount: items.filter((item) => item.status === 'pending').length,
    attentionCount: items.filter((item) => item.status === 'needs_attention').length,
    retrying,
    syncNow,
    retry: (ulid: string) => void retry(ulid),
    grid: {
      loading,
      error,
      onRetry: () => {
        setLoading(true);
        void load();
      },
      onRefresh: async () => {
        await load();
        void requestOutboxSync();
      },
      hasNextPage: false,
      isFetchingNextPage: false,
      nextPageError: null,
      fetchNextPage: () => undefined,
    },
  };
}

export type SyncQueueState = ReturnType<typeof useSyncQueue>;
