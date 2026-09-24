/**
 * Session orchestration: ties the auth endpoints, secure storage and the
 * in-memory session store together. Route files call these; they never touch
 * storage or the API directly.
 */
import Constants from 'expo-constants';

import { getErrorMessage, isApiError } from '@/services/api';
import { getMe, login, logout } from '@/services/auth';
import {
  clearSession,
  getStoredSession,
  getUser,
  saveDeviceCode,
  saveSession,
  saveUser,
} from '@/services/secureStorage';
import type { AuthUser } from '@/services/types';
import { useSessionStore } from '@/stores/session';

export type SignInInput = {
  email: string;
  password: string;
  deviceCode: string;
};

/** `true` when `expiresAt` is missing, unparsable, or not in the future. */
export function isExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return true;
  const expiry = Date.parse(expiresAt);
  return Number.isNaN(expiry) || expiry <= now;
}

function getAppVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

async function clearLocalSession(): Promise<void> {
  await clearSession().catch(() => undefined);
  useSessionStore.getState().setSignedOut();
}

/**
 * Runs at app start (and on Retry):
 * 1. No token, or past `expires_at` → signedOut.
 * 2. `GET /auth/me` succeeds → signedIn with the fresh user.
 * 3. `me` returns 401 → session cleared → signedOut.
 * 4. Any other failure (offline, timeout, 5xx) → signedIn with the cached user
 *    if there is one; otherwise stay in `restoring` with an error for Retry.
 *    Never sign out just because the network is down.
 */
export async function restoreSession(now: number = Date.now()): Promise<void> {
  const store = useSessionStore.getState();
  store.startRestoring();

  const stored = await getStoredSession().catch(() => null);
  if (!stored || isExpired(stored.expiresAt, now)) {
    await clearLocalSession();
    return;
  }

  try {
    const user = await getMe();
    await saveUser(user).catch(() => undefined);
    useSessionStore.getState().setSignedIn(user, stored.expiresAt);
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      // api.ts already cleared the session; make sure regardless.
      await clearLocalSession();
      return;
    }

    const cachedUser = await getUser().catch(() => null);
    if (cachedUser) {
      useSessionStore.getState().setSignedIn(cachedUser, stored.expiresAt, { offline: true });
      return;
    }

    useSessionStore.getState().setRestoreError(getErrorMessage(error));
  }
}

/** POST /auth/login, persist the token + user + device code, then mark signed in. */
export async function signIn(input: SignInInput): Promise<AuthUser> {
  const result = await login({
    email: input.email.trim(),
    password: input.password,
    device_code: input.deviceCode.trim(),
    app_version: getAppVersion(),
  });

  await saveSession(result.token, result.expires_at, result.user);
  await saveDeviceCode(result.user.device.code).catch(() => undefined);
  useSessionStore.getState().setSignedIn(result.user, result.expires_at);
  return result.user;
}

/**
 * POST /auth/logout, then clear local state. Local state is cleared even if
 * the call fails or returns 401 (the contract treats 401 as success here).
 */
export async function signOut(): Promise<void> {
  try {
    await logout();
  } catch {
    // Ignored on purpose: the token is discarded locally either way.
  }
  await clearLocalSession();
}

/** Pre-emptive expiry (contract: "the client may send the user to login after `expires_at`"). */
export async function expireSession(): Promise<void> {
  await clearLocalSession();
}
