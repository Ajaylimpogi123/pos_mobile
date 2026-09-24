import { useEffect } from 'react';

import { expireSession, restoreSession } from '@/services/session';
import { useSessionStore } from '@/stores/session';

/** setTimeout's maximum delay (~24.8 days). Longer delays fire immediately. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Restores the session once at app start, and signs the user out when the
 * token's `expires_at` passes while the app is open.
 */
export function useSessionBootstrap(): void {
  const status = useSessionStore((state) => state.status);
  const expiresAt = useSessionStore((state) => state.expiresAt);

  useEffect(() => {
    void restoreSession();
  }, []);

  useEffect(() => {
    if (status !== 'signedIn' || !expiresAt) return;
    const expiry = Date.parse(expiresAt);
    if (Number.isNaN(expiry)) return;

    const delay = Math.min(Math.max(expiry - Date.now(), 0), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      void expireSession();
    }, delay);
    return () => clearTimeout(timer);
  }, [status, expiresAt]);
}
