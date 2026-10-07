import { create } from 'zustand';

/**
 * Catalogue sync status (docs/api-contract.md → Catalogue Sync → Sync status),
 * shown in the Sell header:
 * - `idle`: no run yet since the app started (the header falls back to the stored `lastServerTime`)
 * - `syncing` · `synced` · `offline` (no network, request skipped) · `error` (with `error`)
 * The Phase 5 sync-queue UX builds on this.
 */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

/** The on-device database: migrations are running, done, or failed. */
export type DatabaseStatus = 'pending' | 'ready' | 'error';

type SyncState = {
  database: DatabaseStatus;
  databaseError: string | null;
  status: SyncStatus;
  /** User-facing message while `status === 'error'`. */
  error: string | null;
  /** `meta.server_time` of the last completed run (ISO 8601 UTC): "Synced N min ago". */
  lastServerTime: string | null;
  /** Bumped after every committed catalogue write, so local menu reads re-run. */
  catalogueVersion: number;

  setDatabaseReady: (lastServerTime: string | null) => void;
  setDatabaseError: (message: string) => void;
  startSync: () => void;
  setSynced: (serverTime: string) => void;
  setOffline: () => void;
  setError: (message: string) => void;
  markCatalogueChanged: () => void;
  /** Test helper: back to the initial state. */
  reset: () => void;
};

const initialState = {
  database: 'pending' as DatabaseStatus,
  databaseError: null,
  status: 'idle' as SyncStatus,
  error: null,
  lastServerTime: null,
  catalogueVersion: 0,
};

/**
 * In-memory sync state. Pure state + setters only: the run lives in
 * `@/sync/catalogueSync` and the data in SQLite (`@/db`).
 */
export const useSyncStore = create<SyncState>()((set) => ({
  ...initialState,

  setDatabaseReady: (lastServerTime) =>
    set((state) => ({ database: 'ready', databaseError: null, lastServerTime: state.lastServerTime ?? lastServerTime })),
  setDatabaseError: (message) => set({ database: 'error', databaseError: message }),
  startSync: () => set({ status: 'syncing', error: null }),
  setSynced: (serverTime) => set({ status: 'synced', error: null, lastServerTime: serverTime }),
  setOffline: () => set({ status: 'offline', error: null }),
  setError: (message) => set({ status: 'error', error: message }),
  markCatalogueChanged: () => set((state) => ({ catalogueVersion: state.catalogueVersion + 1 })),
  reset: () => set(initialState),
}));
