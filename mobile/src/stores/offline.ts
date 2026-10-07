import { create } from 'zustand';

import type { OutboxCounts } from '@/db/offlineRepository';

/**
 * Offline sales state for the screens (docs/api-contract.md → Offline Sales →
 * Device rules): the outbox counts behind the status pill ("Pending (N)",
 * "Needs attention (N)"), whether the worker is sending, and version counters
 * that make local reads (Orders, the Sync queue, the offline stock warnings)
 * run again. Pure state + setters: the data lives in SQLite (`@/db/offlineRepository`)
 * and the work in `@/sync/outboxSync` and `@/sync/stockSync`.
 */
type OfflineState = {
  /** Outbox rows waiting to be sent. */
  pending: number;
  /** Sales the server rejected: kept, with Retry. */
  needsAttention: number;
  /** The outbox worker is sending. */
  syncing: boolean;
  /** Why the last run stopped early (network, server, …); `null` after a clean run. */
  lastError: string | null;
  /** Bumped after every change to `local_orders` / `outbox`. */
  localVersion: number;
  /** Bumped after every change to `stock_cache`. */
  stockVersion: number;

  setCounts: (counts: OutboxCounts) => void;
  startSync: () => void;
  finishSync: (error: string | null) => void;
  markLocalChanged: () => void;
  markStockChanged: () => void;
  /** Test helper: back to the initial state. */
  reset: () => void;
};

const initialState = { pending: 0, needsAttention: 0, syncing: false, lastError: null, localVersion: 0, stockVersion: 0 };

export const useOfflineStore = create<OfflineState>()((set) => ({
  ...initialState,
  setCounts: (counts) => set({ pending: counts.pending, needsAttention: counts.needsAttention }),
  startSync: () => set({ syncing: true }),
  finishSync: (error) => set({ syncing: false, lastError: error }),
  markLocalChanged: () => set((state) => ({ localVersion: state.localVersion + 1 })),
  markStockChanged: () => set((state) => ({ stockVersion: state.stockVersion + 1 })),
  reset: () => set(initialState),
}));
