import { useNetworkState } from 'expo-network';

import { useConnectivityStore } from '@/stores/connectivity';

/**
 * Whether the device has a network connection (expo-network). Only an
 * explicit "not connected" counts as offline: an unknown state lets the
 * request decide, as the catalogue sync does (a LAN-only server has no "internet").
 */
export function useIsOnline(): boolean {
  const state = useNetworkState();
  return state.isConnected !== false;
}

/**
 * Whether sales can reach the server right now: the device is connected
 * **and** the server answered the last request (Offline Sales hardening: the
 * circuit breaker in `@/stores/connectivity`). Checkout, the discount-approval
 * message, the customer picker and the offline stock warnings use this, so
 * after one failed request the next sale is saved on the tablet at once.
 */
export function useCanReachServer(): boolean {
  const deviceConnected = useIsOnline();
  const serverReachable = useConnectivityStore((state) => state.serverReachable);
  return deviceConnected && serverReachable;
}
