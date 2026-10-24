import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { initErrorCapture, refreshErrorsPending, setCurrentScreen } from '@/errors/capture';
import { requestErrorFlush } from '@/errors/errorQueue';
import { useConnectivityStore } from '@/stores/connectivity';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import {
  HEARTBEAT_INTERVAL_MS,
  loadDismissedUpdate,
  requestHeartbeat,
  requestVersionCheck,
} from '@/sync/deviceHealth';

function isForeground(state: AppStateStatus | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

/**
 * Hardening & Pilot (Phase 8) triggers, mounted once in the root layout next
 * to the Offline Sales triggers (so they keep running behind the blocking
 * "Update required" screen):
 *
 * - **Error capture:** set up at launch; `context.screen` follows the route.
 * - **Error queue** (§F): flushed at launch, when the database is ready, on
 *   foreground, every 5 minutes, when the server answers again and after a
 *   sign-in. Signed out too (the endpoint's auth is optional).
 * - **Version check** (§D): at launch, then on foreground (≤ every 15 min).
 * - **Heartbeat** (§E): on sign-in, on foreground (≤ 1/min) and every 5 min
 *   while signed in and in the foreground. Silent; never blocks.
 */
export function useDeviceHealthTriggers(): void {
  const pathname = usePathname();
  const signedIn = useSessionStore((state) => state.status === 'signedIn');
  const databaseReady = useSyncStore((state) => state.database === 'ready');
  const serverReachable = useConnectivityStore((state) => state.serverReachable);
  const [foreground, setForeground] = useState(() => isForeground(AppState.currentState));
  const wasReachable = useRef(serverReachable);

  useEffect(() => {
    setCurrentScreen(pathname);
  }, [pathname]);

  useEffect(() => {
    initErrorCapture();
    void loadDismissedUpdate();
    void requestVersionCheck({ force: true });
    const subscription = AppState.addEventListener('change', (next) => setForeground(isForeground(next)));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!databaseReady) return;
    void refreshErrorsPending();
    void requestErrorFlush();
  }, [databaseReady]);

  // Foreground (and launch): versions, error queue.
  useEffect(() => {
    if (!foreground) return;
    void requestVersionCheck();
    void requestErrorFlush();
    const timer = setInterval(() => void requestErrorFlush(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [foreground]);

  // Signed in and in the foreground: a heartbeat now (≤ 1/min) and every 5 minutes.
  useEffect(() => {
    if (!signedIn || !foreground) return;
    void requestHeartbeat();
    void requestErrorFlush();
    const timer = setInterval(() => void requestHeartbeat({ force: true }), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [signedIn, foreground]);

  // The server answers again after an outage: send what waited.
  useEffect(() => {
    const regained = !wasReachable.current && serverReachable;
    wasReachable.current = serverReachable;
    if (regained) void requestErrorFlush();
  }, [serverReachable]);
}
