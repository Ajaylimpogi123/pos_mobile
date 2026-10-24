/**
 * The session lifecycle (docs/api-contract.md → Auth, Web POS §B/§C):
 * - **Restore:** a stored token → `GET /auth/me` → signed in, then the silent
 *   terminal registration.
 * - **Login:** `POST /auth/login` → store the token → signed in → register the
 *   terminal (`POST /devices/register`, `platform: "web"`).
 * - **Logout:** `POST /auth/logout` (a failure or 401 counts as done), then
 *   the token, session, cart and query cache are cleared.
 * - **401** anywhere (the API client): the token is already cleared; the
 *   session and cache are reset and the app goes to `/login` (once). A retired
 *   terminal's 401 ("This tablet has been retired.") shows its own message.
 * - **403 on registration** (a retired terminal, Hardening & Pilot §C/§I): the
 *   user is signed out and the login page shows the server's message.
 * - The error queue is flushed after login and after a restored session (§I).
 */
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { APP_VERSION } from '@/constants/appVersion';
import { navigateTo } from '@/lib/navigation';
import { flushErrorQueue } from '@/diagnostics/errorQueue';
import {
  getErrorMessage,
  isApiError,
  resetUnauthorizedGuard,
  RETIRED_TERMINAL_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  setUnauthorizedHandler,
} from '@/services/api';
import { getMe, login, logout } from '@/services/auth';
import { registerDevice } from '@/services/devices';
import { queryClient } from '@/services/queryClient';
import { clearToken, getToken, setToken } from '@/services/token';
import type { LoginRequest } from '@/services/types';
import { clearAllCarts } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';
import { getInstallId } from '@/stores/terminal';
import { terminalName } from '@/utils/terminalName';

/** The web build's version, sent as `app_version` (max 20). */
export { APP_VERSION };

let registration: Promise<void> | null = null;

/**
 * `POST /devices/register` for this browser profile. Silent: a failure is
 * kept in the session store and shown where it matters (Sell, printing).
 * Concurrent calls share one request.
 */
export function registerTerminal(): Promise<void> {
  if (registration) return registration;
  const session = useSessionStore.getState();
  session.setDevice({ status: 'registering' });
  registration = (async () => {
    try {
      const device = await registerDevice({
        install_id: getInstallId(),
        name: terminalName(),
        app_version: APP_VERSION,
        platform: 'web',
      });
      if (useSessionStore.getState().status === 'signedIn') useSessionStore.getState().setDevice({ status: 'registered', device });
    } catch (error) {
      if (useSessionStore.getState().status !== 'signedIn') return;
      if (isApiError(error) && error.status === 403) {
        // "This tablet has been retired. Ask a manager to restore it.": no work can be done here.
        await endSession(error.message);
        return;
      }
      useSessionStore.getState().setDevice({ status: 'failed', message: getErrorMessage(error) });
    } finally {
      registration = null;
    }
  })();
  return registration;
}

/** Server logout (failures ignored), then the token, cart, cache and session are cleared and the login page shows `notice`. */
async function endSession(notice: string | null): Promise<void> {
  try {
    await logout();
  } catch {
    // A 401 or a network error: the local session is cleared either way.
  }
  clearToken();
  clearAllCarts();
  queryClient.clear();
  useSessionStore.getState().setSignedOut(notice);
  navigateTo('/login', { replace: true });
}

/** What a 401 does after the client cleared the token (registered once by `useSessionBootstrap`). */
function onUnauthorized(serverMessage: string | null): void {
  const session = useSessionStore.getState();
  const wasSignedIn = session.status === 'signedIn';
  const retired = serverMessage !== null && serverMessage.startsWith(RETIRED_TERMINAL_MESSAGE);
  queryClient.clear();
  session.setSignedOut(wasSignedIn ? (retired ? serverMessage : SESSION_EXPIRED_MESSAGE) : null);
  // Only the signedIn → signedOut transition navigates, so a burst of 401s never loops.
  if (wasSignedIn) navigateTo('/login', { replace: true });
}

export type BootstrapState = { error: string | null; retry: () => void };

/** Restores the session from a stored token on start-up, and wires the 401 handler. */
export function useSessionBootstrap(): BootstrapState {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setUnauthorizedHandler(onUnauthorized);
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      useSessionStore.getState().setSignedOut();
      return;
    }
    void (async () => {
      try {
        const user = await getMe();
        if (cancelled) return;
        setError(null);
        useSessionStore.getState().setSignedIn(user);
        void registerTerminal();
        void flushErrorQueue();
      } catch (caught) {
        if (cancelled) return;
        // A 401 already signed out (the handler); anything else can be retried.
        if (isApiError(caught) && caught.status === 401) return;
        setError(getErrorMessage(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  return { error, retry };
}

/** The login form's mutation: on success the session starts and the terminal registers. */
export function useLogin() {
  return useMutation({
    mutationFn: (body: LoginRequest) => login(body),
    onSuccess: (response) => {
      // A previous session's cached data must never show for the new user (queries only: this mutation stays).
      queryClient.getQueryCache().clear();
      setToken(response.token);
      resetUnauthorizedGuard();
      useSessionStore.getState().setSignedIn(response.user);
      void registerTerminal();
      void flushErrorQueue();
    },
  });
}

/** Logout: the server call never blocks clearing the session. */
export function useLogout() {
  const [pending, setPending] = useState(false);
  const run = useCallback(async () => {
    setPending(true);
    try {
      await logout();
    } catch {
      // A 401 or a network error: the local session is cleared either way.
    } finally {
      clearToken();
      clearAllCarts();
      queryClient.clear();
      useSessionStore.getState().setSignedOut();
      setPending(false);
      navigateTo('/login', { replace: true });
    }
  }, []);
  return { logout: run, pending };
}
