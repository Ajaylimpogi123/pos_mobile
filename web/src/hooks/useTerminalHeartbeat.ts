/**
 * The background heartbeat (Hardening & Pilot §I), mounted by the signed-in shell:
 * - every 5 min while the tab is visible and the terminal is registered;
 * - when the tab becomes visible again, and once the terminal registers;
 * - at most once a minute. Failures are silent and never block the UI.
 */
import { useEffect } from 'react';

import { sendTerminalHeartbeat } from '@/diagnostics/heartbeat';
import { registeredDevice, useSessionStore } from '@/stores/session';

export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
export const HEARTBEAT_MIN_GAP_MS = 60_000;

let lastSentAt = 0;
let inFlight = false;

/** Sends a heartbeat unless one went out in the last minute. Silent. */
export function heartbeatSoon(): void {
  if (inFlight || Date.now() - lastSentAt < HEARTBEAT_MIN_GAP_MS) return;
  if (document.visibilityState !== 'visible') return;
  const session = useSessionStore.getState();
  if (session.status !== 'signedIn' || !registeredDevice(session.device)) return;
  inFlight = true;
  lastSentAt = Date.now();
  sendTerminalHeartbeat()
    .catch(() => {
      // Silent (§I): the next beat tries again.
    })
    .finally(() => {
      inFlight = false;
    });
}

/** Notes a heartbeat sent elsewhere ("This terminal" → Check now), so the timer doesn't double it. */
export function noteHeartbeatSent(): void {
  lastSentAt = Date.now();
}

export function useTerminalHeartbeat(): void {
  const deviceId = useSessionStore((state) => registeredDevice(state.device)?.id ?? null);

  useEffect(() => {
    if (deviceId === null) return;
    heartbeatSoon();
    const timer = window.setInterval(heartbeatSoon, HEARTBEAT_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') heartbeatSoon();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [deviceId]);
}
