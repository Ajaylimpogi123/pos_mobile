import { create } from 'zustand';

import type { AuthUser } from '@/services/types';

export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn';

type SessionState = {
  status: SessionStatus;
  user: AuthUser | null;
  /** ISO 8601 UTC expiry of the current token. */
  expiresAt: string | null;
  /**
   * Set while `status === 'restoring'` when the server could not be reached
   * and there is no cached user to fall back on. The gate shows it with Retry.
   */
  restoreError: string | null;
  /** True when signed in from the cached user because `/auth/me` could not be reached. */
  isOffline: boolean;

  startRestoring: () => void;
  setRestoreError: (message: string) => void;
  setSignedIn: (user: AuthUser, expiresAt: string | null, options?: { offline?: boolean }) => void;
  setUser: (user: AuthUser) => void;
  setSignedOut: () => void;
};

/**
 * In-memory session state. Pure state + setters only: persistence lives in
 * `@/services/secureStorage` and orchestration in `@/services/session`.
 */
export const useSessionStore = create<SessionState>()((set) => ({
  status: 'restoring',
  user: null,
  expiresAt: null,
  restoreError: null,
  isOffline: false,

  startRestoring: () => set({ status: 'restoring', restoreError: null }),
  setRestoreError: (message) => set({ status: 'restoring', restoreError: message }),
  setSignedIn: (user, expiresAt, options) =>
    set({ status: 'signedIn', user, expiresAt, restoreError: null, isOffline: options?.offline ?? false }),
  setUser: (user) => set({ user, isOffline: false }),
  setSignedOut: () => set({ status: 'signedOut', user: null, expiresAt: null, restoreError: null, isOffline: false }),
}));
