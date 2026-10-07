import { create } from 'zustand';

/**
 * Whether the API server answers (Offline Sales hardening). `expo-network`
 * only knows about the device's connection: with Wi-Fi up but the internet
 * (or the server) down, requests hang until their timeout. This flag is the
 * circuit breaker the checkout uses to save sales on the tablet at once.
 *
 * - Any HTTP response (any status) → reachable; a network error or timeout → unreachable
 *   (set by the shared API client, `@/services/api`).
 * - While the device is connected but the server isn't reachable,
 *   `useOfflineSalesTriggers` probes `GET /up` every 15 s.
 */
type ConnectivityState = {
  serverReachable: boolean;
  setServerReachable: (reachable: boolean) => void;
  /** Test helper: back to the initial state. */
  reset: () => void;
};

export const useConnectivityStore = create<ConnectivityState>()((set, get) => ({
  serverReachable: true,
  setServerReachable: (reachable) => {
    if (get().serverReachable !== reachable) set({ serverReachable: reachable });
  },
  reset: () => set({ serverReachable: true }),
}));
