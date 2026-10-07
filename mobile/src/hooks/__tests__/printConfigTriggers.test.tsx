/**
 * The print config syncs on the catalogue-sync triggers (docs/api-contract.md
 * → Printing → Device rules → Config): after login and restore, on returning
 * to the foreground, and every 5 minutes in the foreground. The runs
 * themselves are mocked; their rules are in printConfigSync.test.ts.
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useCatalogueSyncTriggers } from '@/hooks/useCatalogueSyncTriggers';
import { useSessionStore } from '@/stores/session';
import { FOREGROUND_SYNC_INTERVAL_MS, requestCatalogueSync } from '@/sync/catalogueSync';
import { requestPrintConfigSync } from '@/sync/printConfigSync';
import { cashierUser } from '@/test-utils';

jest.mock('@/sync/catalogueSync', () => ({
  ...jest.requireActual<typeof import('@/sync/catalogueSync')>('@/sync/catalogueSync'),
  requestCatalogueSync: jest.fn(async () => ({ outcome: 'offline', changed: false })),
}));

jest.mock('@/sync/printConfigSync', () => ({
  requestPrintConfigSync: jest.fn(async () => ({ outcome: 'offline' })),
}));

const FUTURE = '2099-09-25T01:30:00Z';
const catalogue = requestCatalogueSync as jest.Mock;
const printConfig = requestPrintConfigSync as jest.Mock;
let appStateListener: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  catalogue.mockClear();
  printConfig.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  useSessionStore.getState().setSignedOut();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('syncs the print config next to every catalogue sync: sign-in, foreground, and every 5 minutes', async () => {
  jest.useFakeTimers();
  await renderHook(() => useCatalogueSyncTriggers());
  expect(printConfig).not.toHaveBeenCalled();

  await act(async () => useSessionStore.getState().setSignedIn(cashierUser, FUTURE));
  expect(printConfig).toHaveBeenCalledTimes(1);

  await act(async () => appStateListener?.('background'));
  await act(async () => appStateListener?.('active'));
  expect(printConfig).toHaveBeenCalledTimes(2);

  await act(async () => jest.advanceTimersByTime(FOREGROUND_SYNC_INTERVAL_MS));
  expect(printConfig).toHaveBeenCalledTimes(3);
  expect(catalogue).toHaveBeenCalledTimes(printConfig.mock.calls.length);
});
