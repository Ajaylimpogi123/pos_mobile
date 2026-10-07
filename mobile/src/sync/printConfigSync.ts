/**
 * Print config sync (docs/api-contract.md → Printing → Device rules → Config):
 * `GET /api/v1/print-config` cached in SQLite, keyed by branch and API
 * origin, and loaded at startup.
 *
 * - It runs on the catalogue-sync triggers (login and restore, foreground,
 *   every 5 minutes, "Sync now") and after any printer or settings change
 *   made in the app.
 * - Offline (expo-network), the request is skipped and the cache is used. A
 *   failed request never clears the cache. Logout keeps it.
 * - **One run at a time:** a trigger during a run joins it (the same promise).
 *
 * `runPrintConfigSync` is pure apart from its `deps`, like `runCatalogueSync`.
 */
import { prepareDatabase } from '@/db/database';
import { printRepository, type PrintRepository } from '@/db/printRepository';
import { API_BASE_URL, getErrorMessage } from '@/services/api';
import { getPrintConfig } from '@/services/printConfig';
import type { PrintConfig } from '@/services/types';
import { usePrintingStore } from '@/stores/printing';
import { isDeviceOnline } from '@/sync/catalogueSync';

export type PrintConfigSyncDeps = {
  fetchConfig: () => Promise<PrintConfig>;
  repository: Pick<PrintRepository, 'saveConfig'>;
  isOnline: () => Promise<boolean>;
  /** The configured API origin (`EXPO_PUBLIC_API_URL`): part of the cache key. */
  apiOrigin: string;
  prepareDatabase: () => Promise<boolean>;
  now: () => number;
};

export type PrintConfigSyncResult =
  | { outcome: 'synced'; config: PrintConfig }
  | { outcome: 'offline' }
  | { outcome: 'error'; error: unknown };

export const PRINT_STORAGE_ERROR_MESSAGE = "Printer settings couldn't be saved on this device.";

/** One attempt. Never throws. */
export async function runPrintConfigSync(deps: PrintConfigSyncDeps): Promise<PrintConfigSyncResult> {
  try {
    // Printing needs the on-device database (cache and queue): without it there is nothing to sync into.
    if (!(await deps.prepareDatabase())) return { outcome: 'error', error: new Error(PRINT_STORAGE_ERROR_MESSAGE) };
    if (!(await deps.isOnline())) return { outcome: 'offline' };
    const config = await deps.fetchConfig();
    await deps.repository.saveConfig(deps.apiOrigin, config, new Date(deps.now()).toISOString());
    return { outcome: 'synced', config };
  } catch (error) {
    return { outcome: 'error', error };
  }
}

/** The message shown for a failed run. */
export function printConfigErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === PRINT_STORAGE_ERROR_MESSAGE) return error.message;
  return getErrorMessage(error);
}

/** Wraps `runPrintConfigSync`: single-flight, and the result goes to the printing store. */
export function createPrintConfigSyncRunner(getDeps: () => PrintConfigSyncDeps) {
  let inFlight: Promise<PrintConfigSyncResult> | null = null;

  async function run(): Promise<PrintConfigSyncResult> {
    const store = usePrintingStore.getState();
    store.setConfigStatus('syncing');
    const result = await runPrintConfigSync(getDeps());
    if (result.outcome === 'synced') {
      store.setConfig(result.config);
      store.setConfigStatus('synced');
    } else if (result.outcome === 'offline') {
      store.setConfigStatus('offline');
    } else {
      store.setConfigStatus('error', printConfigErrorMessage(result.error));
    }
    return result;
  }

  return function request(): Promise<PrintConfigSyncResult> {
    if (inFlight) return inFlight;
    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

function appDeps(): PrintConfigSyncDeps {
  return {
    fetchConfig: getPrintConfig,
    repository: printRepository,
    isOnline: isDeviceOnline,
    apiOrigin: API_BASE_URL,
    prepareDatabase,
    now: Date.now,
  };
}

/**
 * Starts a print config sync, or joins the one running. Called next to every
 * catalogue-sync trigger and after printer / settings changes. Never rejects.
 */
export const requestPrintConfigSync = createPrintConfigSyncRunner(appDeps);
