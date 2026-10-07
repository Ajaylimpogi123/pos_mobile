/**
 * Session orchestration: ties the auth endpoints, secure storage and the
 * in-memory session store together. Route files call these; they never touch
 * storage or the API directly.
 */
import { getErrorMessage, isApiError } from '@/services/api';
import { getMe, login, logout, pinLogin } from '@/services/auth';
import {
  clearSession,
  deleteLegacyKeys,
  getStoredSession,
  getUser,
  saveSession,
  saveUser,
} from '@/services/secureStorage';
import type { AuthUser, LoginResponse } from '@/services/types';
import { useSessionStore } from '@/stores/session';

export type SignInInput = {
  email: string;
  password: string;
};

export type PinSignInInput = {
  userId: number;
  /** 4–6 digits. Sent once, never stored. */
  pin: string;
};

/** `true` when `expiresAt` is missing, unparsable, or not in the future. */
export function isExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return true;
  const expiry = Date.parse(expiresAt);
  return Number.isNaN(expiry) || expiry <= now;
}

async function clearLocalSession(): Promise<void> {
  await clearSession().catch(() => undefined);
  useSessionStore.getState().setSignedOut();
}

/**
 * Runs at app start (and on Retry):
 * 0. Best-effort cleanup of storage keys older builds wrote (never blocks).
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

  await deleteLegacyKeys();

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

/**
 * POST /auth/login with `email` + `password` only, persist the token + user,
 * then mark signed in. Errors (422 / 401 / 403 / 429 / network) propagate to
 * the form; a 401 here never touches the session (the call is `auth: false`).
 */
export async function signIn(input: SignInInput): Promise<AuthUser> {
  const result = await login({
    email: input.email.trim(),
    password: input.password,
  });
  return startSession(result);
}

/**
 * PIN quick-switch (POST /auth/pin): the device's session becomes the target
 * user's, exactly as a login does (token, expiry and user saved, then signed
 * in). The server revokes the previous user's token; a late 401 for that old
 * token is ignored by the API client. Errors (422 / 429 / network) propagate
 * to the PIN screen, and the current session stays as it was.
 */
export async function signInWithPin(input: PinSignInInput): Promise<AuthUser> {
  const result = await pinLogin({ user_id: input.userId, pin: input.pin });
  return startSession(result);
}

/** Persists a login-shaped response and marks the user signed in. */
async function startSession(result: LoginResponse): Promise<AuthUser> {
  await saveSession(result.token, result.expires_at, result.user);
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

/**
 * The signed-in user edited their own name or email (e.g. on the staff
 * screen): update the session store and the cached user, so home shows the
 * new values straight away (and after an offline restart).
 */
export async function updateSessionProfile(changes: Pick<AuthUser, 'name' | 'email'>): Promise<void> {
  const current = useSessionStore.getState().user;
  if (!current) return;
  const next: AuthUser = { ...current, name: changes.name, email: changes.email };
  useSessionStore.getState().setUser(next);
  await saveUser(next).catch(() => undefined);
}
