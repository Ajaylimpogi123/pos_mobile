/**
 * Offline Sales triggers and device registration (docs/api-contract.md →
 * Offline Sales → Device rules → Registration, Sync worker → Triggers):
 * - `POST /devices/register` after login, restore and PIN switch while online (not after an offline restore)
 * - the outbox worker on sign-in, foreground, the 5-minute timer and **reconnect**
 * - the stock cache on the catalogue-sync triggers
 * - the `install_id` made once, and the cached `{id, code}`
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { SERVER_PROBE_INTERVAL_MS, useOfflineSalesTriggers } from '@/hooks/useOfflineSalesTriggers';
import { useConnectivityStore } from '@/stores/connectivity';
import { useDeviceStore } from '@/stores/device';
import { useSessionStore } from '@/stores/session';
import { FOREGROUND_SYNC_INTERVAL_MS, requestCatalogueSync } from '@/sync/catalogueSync';
import { registerThisDevice } from '@/sync/deviceRegistration';
import { requestOutboxSync } from '@/sync/outboxSync';
import { requestPrintConfigSync } from '@/sync/printConfigSync';
import { requestStockSync } from '@/sync/stockSync';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, routeFetch } from '@/test-utils/catalog';
import { isUlid } from '@/utils/ulid';

jest.mock('@/sync/deviceRegistration', () => ({
  ...jest.requireActual<typeof import('@/sync/deviceRegistration')>('@/sync/deviceRegistration'),
  registerThisDevice: jest.fn(async () => ({ id: 1, code: 'T01', name: 'Tab' })),
}));
jest.mock('@/sync/outboxSync', () => ({
  ...jest.requireActual<typeof import('@/sync/outboxSync')>('@/sync/outboxSync'),
  requestOutboxSync: jest.fn(async () => ({ outcome: 'offline' })),
  refreshOutboxCounts: jest.fn(async () => undefined),
}));
jest.mock('@/sync/catalogueSync', () => ({
  ...jest.requireActual<typeof import('@/sync/catalogueSync')>('@/sync/catalogueSync'),
  requestCatalogueSync: jest.fn(async () => ({ outcome: 'offline', changed: false })),
}));
jest.mock('@/sync/printConfigSync', () => ({
  requestPrintConfigSync: jest.fn(async () => ({ outcome: 'offline' })),
}));
jest.mock('@/sync/stockSync', () => ({
  requestStockSync: jest.fn(async () => ({ outcome: 'skipped' })),
}));

const FUTURE = '2099-09-25T01:30:00Z';
const LATER = '2099-09-26T01:30:00Z';
const register = registerThisDevice as jest.Mock;
const outbox = requestOutboxSync as jest.Mock;
const stock = requestStockSync as jest.Mock;
const catalogue = requestCatalogueSync as jest.Mock;
const printConfig = requestPrintConfigSync as jest.Mock;

/** The four syncs of "connection regained", each called `times` times. */
function expectAllSyncs(times: number) {
  for (const runner of [outbox, catalogue, printConfig, stock]) expect(runner).toHaveBeenCalledTimes(times);
}

function clearSyncs() {
  for (const runner of [outbox, catalogue, printConfig, stock]) runner.mockClear();
}
const network = jest.requireMock('expo-network') as { getNetworkStateAsync: jest.Mock; addNetworkStateListener: jest.Mock };

let appStateListener: ((state: AppStateStatus) => void) | null = null;
let networkListener: ((state: { isConnected: boolean }) => void) | null = null;

beforeEach(() => {
  register.mockClear();
  outbox.mockClear();
  stock.mockClear();
  appStateListener = null;
  networkListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  network.addNetworkStateListener.mockImplementation((listener: (state: { isConnected: boolean }) => void) => {
    networkListener = listener;
    return { remove: jest.fn() };
  });
  network.getNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
  secureStoreMock().__resetSecureStore();
  useDeviceStore.getState().reset();
  useConnectivityStore.getState().reset();
  catalogue.mockClear();
  printConfig.mockClear();
  useSessionStore.getState().setSignedOut();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('registration', () => {
  it('registers after login and after a PIN switch (a new token), not while signed out', async () => {
    await renderHook(() => useOfflineSalesTriggers());
    expect(register).not.toHaveBeenCalled();

    await act(async () => useSessionStore.getState().setSignedIn(cashierUser, FUTURE));
    expect(register).toHaveBeenCalledTimes(1);

    // PIN switch: signed in all along, but a new token (new expiry) for another user.
    await act(async () => useSessionStore.getState().setSignedIn({ ...cashierUser, id: 2, name: 'Mia Manager' }, LATER));
    expect(register).toHaveBeenCalledTimes(2);

    // Editing the profile is not a new session.
    await act(async () => useSessionStore.getState().setUser({ ...cashierUser, id: 2, name: 'Mia M.' }));
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('registers after a session restore, but not after a restore from the cached user while the server is out of reach', async () => {
    await renderHook(() => useOfflineSalesTriggers());
    await act(async () => useSessionStore.getState().setSignedIn(cashierUser, FUTURE, { offline: true }));
    expect(register).not.toHaveBeenCalled();

    await act(async () => useSessionStore.getState().setSignedOut());
    await act(async () => useSessionStore.getState().setSignedIn(cashierUser, FUTURE));
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('only while online', async () => {
    network.getNetworkStateAsync.mockResolvedValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    await renderHook(() => useOfflineSalesTriggers());
    await act(async () => useSessionStore.getState().setSignedIn(cashierUser, FUTURE));
    expect(register).not.toHaveBeenCalled();
  });
});

describe('outbox and stock triggers', () => {
  it('sync on sign-in and on returning to the foreground', async () => {
    await renderHook(() => useOfflineSalesTriggers());
    expect(outbox).not.toHaveBeenCalled();

    await act(async () => useSessionStore.getState().setSignedIn(cashierUser, FUTURE));
    expect(outbox).toHaveBeenCalledTimes(1);
    expect(stock).toHaveBeenCalledTimes(1);

    await act(async () => appStateListener?.('background'));
    await act(async () => appStateListener?.('active'));
    expect(outbox).toHaveBeenCalledTimes(2);
    expect(stock).toHaveBeenCalledTimes(2);
  });

  it('every 5 minutes in the foreground', async () => {
    jest.useFakeTimers();
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    await renderHook(() => useOfflineSalesTriggers());
    expect(outbox).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(FOREGROUND_SYNC_INTERVAL_MS));
    expect(outbox).toHaveBeenCalledTimes(2);
    expect(stock).toHaveBeenCalledTimes(2);
  });

  it('on reconnect: the connection comes back → the outbox, catalogue, print-config and stock syncs all run', async () => {
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    await renderHook(() => useOfflineSalesTriggers());
    clearSyncs();

    await act(async () => networkListener?.({ isConnected: false }));
    expectAllSyncs(0);
    await act(async () => networkListener?.({ isConnected: true }));
    expectAllSyncs(1);
    // Still connected: not a reconnect.
    await act(async () => networkListener?.({ isConnected: true }));
    expectAllSyncs(1);
  });

  it('server probe: while connected but the server is unreachable, GET /up every 15 s; its answer runs all four syncs', async () => {
    jest.useFakeTimers();
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    let up = false;
    const { calls } = routeFetch([
      { method: 'GET', path: '/up', reply: () => (up ? mockResponse(200, {}) : Promise.reject(new TypeError('Network request failed'))) },
    ]);
    await renderHook(() => useOfflineSalesTriggers());
    // No probing while the server answers.
    await act(async () => jest.advanceTimersByTime(SERVER_PROBE_INTERVAL_MS * 2));
    expect(calls).toHaveLength(0);

    await act(async () => useConnectivityStore.getState().setServerReachable(false));
    clearSyncs();
    await act(async () => jest.advanceTimersByTime(SERVER_PROBE_INTERVAL_MS));
    expect(calls.map((call) => call.path)).toEqual(['/up']);
    expect(useConnectivityStore.getState().serverReachable).toBe(false);
    expectAllSyncs(0);

    up = true;
    await act(async () => jest.advanceTimersByTime(SERVER_PROBE_INTERVAL_MS));
    expect(useConnectivityStore.getState().serverReachable).toBe(true);
    expectAllSyncs(1);

    // Reachable again: the loop stops.
    await act(async () => jest.advanceTimersByTime(SERVER_PROBE_INTERVAL_MS * 3));
    expect(calls).toHaveLength(2);
  });

  it('server probe: not while signed out or when the device itself is offline', async () => {
    jest.useFakeTimers();
    const { calls } = routeFetch([{ method: 'GET', path: '/up', reply: () => mockResponse(200, {}) }]);
    useConnectivityStore.getState().setServerReachable(false);
    await renderHook(() => useOfflineSalesTriggers());
    await act(async () => jest.advanceTimersByTime(SERVER_PROBE_INTERVAL_MS * 2));
    expect(calls).toHaveLength(0);

    const useNetworkState = jest.requireMock('expo-network').useNetworkState as jest.Mock;
    useNetworkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    try {
      await act(async () => useSessionStore.getState().setSignedIn(cashierUser, FUTURE));
      await act(async () => jest.advanceTimersByTime(SERVER_PROBE_INTERVAL_MS * 2));
      expect(calls).toHaveLength(0);
    } finally {
      useNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
    }
  });
});

describe('registerThisDevice', () => {
  const realRegister = jest.requireActual<typeof import('@/sync/deviceRegistration')>('@/sync/deviceRegistration').registerThisDevice;

  it('sends the install_id (made once, then reused), the name and the app version; caches {id, code} for this server and branch', async () => {
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    const { calls } = routeFetch([
      { method: 'POST', path: '/api/v1/devices/register', reply: () => mockResponse(200, { data: { id: 1, code: 'T01', name: 'Galaxy Tab' } }) },
    ]);

    expect(await realRegister()).toEqual({ id: 1, code: 'T01', name: 'Galaxy Tab' });
    await realRegister();

    const [first, second] = calls.map((call) => jsonBody(call) as { install_id: string; name: string; app_version: string | null });
    expect(isUlid(first.install_id)).toBe(true);
    expect(second.install_id).toBe(first.install_id);
    expect(first.name.length).toBeGreaterThan(0);
    expect(first.name.length).toBeLessThanOrEqual(60);
    expect(Object.keys(first).sort()).toEqual(['app_version', 'install_id', 'name']);
    expect(useDeviceStore.getState().device).toEqual({ id: 1, code: 'T01', apiOrigin: 'http://192.168.1.50:8000', branchId: 1 });
    expect(JSON.parse((await secureStoreMock().getItemAsync('pos.device.registered')) as string)).toMatchObject({ code: 'T01' });
  });

  it('409 "This tablet is registered to another branch.": keeps the message, caches nothing', async () => {
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    routeFetch([
      { method: 'POST', path: '/api/v1/devices/register', reply: () => mockResponse(409, { message: 'This tablet is registered to another branch.' }) },
    ]);

    expect(await realRegister()).toBeNull();
    expect(useDeviceStore.getState()).toMatchObject({ device: null, error: 'This tablet is registered to another branch.' });
    expect(await secureStoreMock().getItemAsync('pos.device.registered')).toBeNull();
  });
});
