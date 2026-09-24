import * as SecureStore from 'expo-secure-store';

import type { AuthUser } from '@/services/types';

/**
 * Everything the session persists lives in expo-secure-store (encrypted at
 * rest). Never put the token in AsyncStorage or plain state.
 *
 * Keys may only contain alphanumerics, `.`, `-` and `_`.
 */
const KEYS = {
  token: 'pos.auth.token',
  expiresAt: 'pos.auth.expires_at',
  user: 'pos.auth.user',
  deviceCode: 'pos.device.code',
} as const;

export type StoredSession = {
  token: string;
  expiresAt: string | null;
};

// --- Token + expiry --------------------------------------------------------

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.token);
}

export async function getStoredSession(): Promise<StoredSession | null> {
  const [token, expiresAt] = await Promise.all([
    SecureStore.getItemAsync(KEYS.token),
    SecureStore.getItemAsync(KEYS.expiresAt),
  ]);
  if (!token) return null;
  return { token, expiresAt };
}

export async function saveSession(token: string, expiresAt: string, user: AuthUser): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.token, token),
    SecureStore.setItemAsync(KEYS.expiresAt, expiresAt),
    saveUser(user),
  ]);
}

/** Removes the token, its expiry and the cached user. Keeps the remembered device code. */
export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.token),
    SecureStore.deleteItemAsync(KEYS.expiresAt),
    SecureStore.deleteItemAsync(KEYS.user),
  ]);
}

// --- Cached user (lets the app open offline) -------------------------------

export async function saveUser(user: AuthUser): Promise<void> {
  await SecureStore.setItemAsync(KEYS.user, JSON.stringify(user));
}

export async function getUser(): Promise<AuthUser | null> {
  const raw = await SecureStore.getItemAsync(KEYS.user);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

// --- Remembered device code (survives logout) ------------------------------

export async function getDeviceCode(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.deviceCode);
}

export async function saveDeviceCode(code: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.deviceCode, code);
}
