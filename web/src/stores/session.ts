import { create } from 'zustand';

import type { AuthUser, RegisteredDevice } from '@/services/types';

/**
 * Who is signed in on this browser, and the terminal registration
 * (docs/api-contract.md → Web POS §B/§C). The token itself lives in
 * `@/services/token`; this store holds only the in-memory session.
 */
export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn';

/** The silent `POST /devices/register` after login. */
export type DeviceState =
  | { status: 'idle' }
  | { status: 'registering' }
  | { status: 'registered'; device: RegisteredDevice }
  | { status: 'failed'; message: string };

type SessionState = {
  status: SessionStatus;
  user: AuthUser | null;
  device: DeviceState;
  /** Shown on the login page after a 401 ("Your session has ended…"). */
  notice: string | null;
  setSignedIn: (user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  setSignedOut: (notice?: string | null) => void;
  setDevice: (device: DeviceState) => void;
  clearNotice: () => void;
};

export const useSessionStore = create<SessionState>()((set) => ({
  status: 'restoring',
  user: null,
  device: { status: 'idle' },
  notice: null,
  setSignedIn: (user) => set({ status: 'signedIn', user, notice: null }),
  setUser: (user) => set({ user }),
  setSignedOut: (notice = null) => set({ status: 'signedOut', user: null, device: { status: 'idle' }, notice }),
  setDevice: (device) => set({ device }),
  clearNotice: () => set({ notice: null }),
}));

/** The registered terminal, or `null` while it isn't registered. */
export function registeredDevice(state: DeviceState): RegisteredDevice | null {
  return state.status === 'registered' ? state.device : null;
}
