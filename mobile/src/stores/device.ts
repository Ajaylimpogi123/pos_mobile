import { create } from 'zustand';

import type { CachedDevice } from '@/services/secureStorage';

/**
 * This tablet's registration (docs/api-contract.md → Offline Sales → Device
 * rules → Registration): the cached `{id, code}` from `POST /devices/register`,
 * loaded from SecureStore at startup and replaced after each registration.
 * Pure state + setters: the registration itself lives in `@/sync/deviceRegistration`.
 */
type DeviceState = {
  /** `true` once the cached device has been read from SecureStore (or found missing). */
  loaded: boolean;
  /** The registered device (for this API origin and branch it was registered with), or `null`. */
  device: CachedDevice | null;
  registering: boolean;
  /** The last registration's error (e.g. "This tablet is registered to another branch."). */
  error: string | null;

  setLoaded: (device: CachedDevice | null) => void;
  startRegistering: () => void;
  setRegistered: (device: CachedDevice) => void;
  setRegistrationError: (message: string) => void;
  /** Test helper: back to the initial state. */
  reset: () => void;
};

const initialState = { loaded: false, device: null, registering: false, error: null };

export const useDeviceStore = create<DeviceState>()((set) => ({
  ...initialState,
  setLoaded: (device) => set((state) => ({ loaded: true, device: state.device ?? device })),
  startRegistering: () => set({ registering: true }),
  setRegistered: (device) => set({ loaded: true, device, registering: false, error: null }),
  setRegistrationError: (message) => set({ registering: false, error: message }),
  reset: () => set(initialState),
}));
