import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useSessionStore } from '@/stores/session';
import { FOREGROUND_SYNC_INTERVAL_MS, requestCatalogueSync } from '@/sync/catalogueSync';
import { requestPrintConfigSync } from '@/sync/printConfigSync';

/** `true` unless the app is backgrounded (an unknown state at launch counts as foreground). */
function isForeground(state: AppStateStatus | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

/**
 * The automatic catalogue-sync triggers (docs/api-contract.md → Catalogue
 * Sync → "When to sync"), mounted once in the root layout:
 * - after a successful login and after a session restore (the session status
 *   becomes `signedIn`)
 * - when the app returns to the foreground
 * - every 5 minutes while in the foreground (each run checks the network and
 *   skips the request when offline)
 * "Sync now" and the admin catalogue mutations call `requestCatalogueSync`
 * themselves. A trigger during a run joins it.
 *
 * Printing (Phase 4): the print config (`GET /print-config`) refreshes on the
 * same triggers, next to each catalogue sync.
 */
export function useCatalogueSyncTriggers(): void {
  const signedIn = useSessionStore((state) => state.status === 'signedIn');
  const [foreground, setForeground] = useState(() => isForeground(AppState.currentState));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setForeground(isForeground(next)));
    return () => subscription.remove();
  }, []);

  // Signed in (login or restore), or back in the foreground while signed in.
  useEffect(() => {
    if (!signedIn || !foreground) return;
    void requestCatalogueSync();
    void requestPrintConfigSync();
  }, [signedIn, foreground]);

  useEffect(() => {
    if (!signedIn || !foreground) return;
    const timer = setInterval(() => {
      void requestCatalogueSync();
      void requestPrintConfigSync();
    }, FOREGROUND_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [signedIn, foreground]);
}
