import * as Network from 'expo-network';
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useIsOnline } from '@/hooks/useIsOnline';
import { probeServer } from '@/services/api';
import { useConnectivityStore } from '@/stores/connectivity';
import { useSessionStore } from '@/stores/session';
import { FOREGROUND_SYNC_INTERVAL_MS, isDeviceOnline } from '@/sync/catalogueSync';
import { requestConnectionRegainedSyncs } from '@/sync/connectionRegained';
import { loadCachedDevice, registerThisDevice } from '@/sync/deviceRegistration';
import { refreshOutboxCounts, requestOutboxSync } from '@/sync/outboxSync';
import { requestStockSync } from '@/sync/stockSync';

/** While the device is connected but the server doesn't answer, `GET /up` is tried this often. */
export const SERVER_PROBE_INTERVAL_MS = 15_000;

/** `true` unless the app is backgrounded (an unknown state at launch counts as foreground). */
function isForeground(state: AppStateStatus | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

/**
 * The Offline Sales triggers (docs/api-contract.md → Offline Sales → Device
 * rules), mounted once in the root layout next to the catalogue-sync triggers:
 *
 * - **Registration** (`POST /devices/register`): after a login, a session
 *   restore and a PIN switch, while online. Each of these starts a new token
 *   (a new `expires_at`), which is what this watches; a restore from the
 *   cached user while the server is out of reach doesn't register.
 * - **Outbox worker:** on login and restore, back in the foreground, every 5
 *   minutes in the foreground. "Sync now" and each offline sale call it themselves.
 * - **Connection regained** (hardening): when expo-network reports a connection
 *   again, or the server answers again, the outbox, catalogue, print-config
 *   and stock syncs all run (`requestConnectionRegainedSyncs`).
 * - **Server probe** (hardening): while the device is connected but the server
 *   doesn't answer (the circuit breaker is open), `GET /up` every 15 s, in the
 *   foreground and signed in; its answer closes the breaker.
 * - **Stock cache** (`GET /sync/stock`): on the catalogue-sync triggers (login
 *   and restore, foreground, every 5 minutes); "Sync now" and each online sale
 *   call it themselves.
 * - At startup: the cached device and the outbox counts are loaded, so the
 *   pill and the checkout know them before any network call.
 * Nothing runs while signed out: the outbox is kept until someone signs in.
 */
export function useOfflineSalesTriggers(): void {
  const signedIn = useSessionStore((state) => state.status === 'signedIn');
  const restoredOffline = useSessionStore((state) => state.isOffline);
  // A new token: login, restore or PIN switch (each has its own expiry), for this user.
  const sessionKey = useSessionStore((state) =>
    state.status === 'signedIn' && state.user ? `${state.user.id}|${state.expiresAt ?? ''}` : null,
  );
  const [foreground, setForeground] = useState(() => isForeground(AppState.currentState));
  const wasConnected = useRef<boolean | null>(null);
  const deviceConnected = useIsOnline();
  const serverReachable = useConnectivityStore((state) => state.serverReachable);
  const wasReachable = useRef(serverReachable);

  useEffect(() => {
    void loadCachedDevice();
    void refreshOutboxCounts();
    const subscription = AppState.addEventListener('change', (next) => setForeground(isForeground(next)));
    return () => subscription.remove();
  }, []);

  // Register after login, restore and PIN switch, while online.
  useEffect(() => {
    if (sessionKey === null || restoredOffline) return;
    let active = true;
    void (async () => {
      if (active && (await isDeviceOnline())) await registerThisDevice();
    })();
    return () => {
      active = false;
    };
  }, [sessionKey, restoredOffline]);

  // Signed in (login or restore), or back in the foreground while signed in.
  useEffect(() => {
    if (!signedIn || !foreground) return;
    void requestOutboxSync();
    void requestStockSync();
  }, [signedIn, foreground]);

  useEffect(() => {
    if (!signedIn || !foreground) return;
    const timer = setInterval(() => {
      void requestOutboxSync();
      void requestStockSync();
    }, FOREGROUND_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [signedIn, foreground]);

  // Reconnect: the connection came back.
  useEffect(() => {
    if (!signedIn) return;
    const subscription = Network.addNetworkStateListener((state) => {
      const connected = state.isConnected !== false;
      const reconnected = wasConnected.current === false && connected;
      wasConnected.current = connected;
      if (reconnected) requestConnectionRegainedSyncs();
    });
    return () => subscription.remove();
  }, [signedIn]);

  // The server answers again (a probe, or any other request): everything syncs.
  useEffect(() => {
    const regained = !wasReachable.current && serverReachable;
    wasReachable.current = serverReachable;
    if (regained && signedIn) requestConnectionRegainedSyncs();
  }, [serverReachable, signedIn]);

  // Connected, but the server doesn't answer: probe until it does (one loop).
  useEffect(() => {
    if (!signedIn || !foreground || !deviceConnected || serverReachable) return;
    const timer = setInterval(() => {
      void probeServer();
    }, SERVER_PROBE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [signedIn, foreground, deviceConnected, serverReachable]);
}
