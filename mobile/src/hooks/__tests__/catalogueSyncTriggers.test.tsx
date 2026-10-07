/**
 * When a catalogue sync starts (docs/api-contract.md → Catalogue Sync → "When
 * to sync"): after login and session restore, on returning to the foreground,
 * every 5 minutes in the foreground, and after a successful admin catalogue
 * change. The run itself is mocked here; its rules are in catalogueSync.test.ts.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useCategoryMutations, useProductMutations } from '@/hooks/menu/useCatalogMutations';
import { useToggleProductAvailability } from '@/hooks/menu/useAdminProducts';
import { useCatalogueSyncTriggers } from '@/hooks/useCatalogueSyncTriggers';
import { useSessionStore } from '@/stores/session';
import { FOREGROUND_SYNC_INTERVAL_MS, requestCatalogueSync } from '@/sync/catalogueSync';
import { cashierUser, mockResponse } from '@/test-utils';
import { createTestQueryClient, makeCategory, makeProduct, routeFetch } from '@/test-utils/catalog';

jest.mock('@/sync/catalogueSync', () => ({
  ...jest.requireActual<typeof import('@/sync/catalogueSync')>('@/sync/catalogueSync'),
  requestCatalogueSync: jest.fn(async () => ({ outcome: 'offline', changed: false })),
}));

const FUTURE = '2026-09-25T01:30:00Z';
const requestSync = requestCatalogueSync as jest.Mock;

let appStateListener: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  requestSync.mockClear();
  appStateListener = null;
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

describe('useCatalogueSyncTriggers', () => {
  it('syncs once signed in (login or restore), not while signed out', async () => {
    await renderHook(() => useCatalogueSyncTriggers());
    expect(requestSync).not.toHaveBeenCalled();

    await act(async () => useSessionStore.getState().setSignedIn(cashierUser, FUTURE));
    expect(requestSync).toHaveBeenCalledTimes(1);

    // Signing out and in again (another user) syncs again.
    await act(async () => useSessionStore.getState().setSignedOut());
    await act(async () => useSessionStore.getState().setSignedIn(cashierUser, FUTURE));
    expect(requestSync).toHaveBeenCalledTimes(2);
  });

  it('syncs when the app returns to the foreground', async () => {
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    await renderHook(() => useCatalogueSyncTriggers());
    expect(requestSync).toHaveBeenCalledTimes(1);

    await act(async () => appStateListener?.('background'));
    expect(requestSync).toHaveBeenCalledTimes(1);
    await act(async () => appStateListener?.('active'));
    expect(requestSync).toHaveBeenCalledTimes(2);
  });

  it('syncs every 5 minutes while in the foreground, and stops in the background', async () => {
    jest.useFakeTimers();
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    await renderHook(() => useCatalogueSyncTriggers());
    expect(requestSync).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(FOREGROUND_SYNC_INTERVAL_MS));
    expect(requestSync).toHaveBeenCalledTimes(2);

    await act(async () => appStateListener?.('background'));
    await act(async () => jest.advanceTimersByTime(FOREGROUND_SYNC_INTERVAL_MS * 3));
    expect(requestSync).toHaveBeenCalledTimes(2);
  });
});

describe('admin catalogue changes', () => {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
  }

  it('syncs after a successful product create, availability toggle and delete (not after a failure)', async () => {
    const product = makeProduct();
    routeFetch([
      { method: 'POST', path: '/api/v1/admin/products', reply: () => mockResponse(201, { data: product }) },
      { method: 'PATCH', path: '/api/v1/admin/products/7', reply: () => mockResponse(200, { data: { ...product, is_available: false } }) },
      { method: 'DELETE', path: '/api/v1/admin/products/7', reply: () => mockResponse(204) },
      { method: 'DELETE', path: '/api/v1/admin/products/8', reply: () => mockResponse(500, { message: 'Server Error.' }) },
    ]);
    const { result } = await renderHook(() => ({ ...useProductMutations(), toggle: useToggleProductAvailability() }), {
      wrapper,
    });

    await act(async () => {
      await result.current.create.mutateAsync({ category_id: 2, name: 'Egg with Rice', price_cents: 5000 });
    });
    expect(requestSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.toggle.mutateAsync({ id: 7, isAvailable: false });
    });
    expect(requestSync).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.remove.mutateAsync(7);
    });
    expect(requestSync).toHaveBeenCalledTimes(3);

    await act(async () => {
      await result.current.remove.mutateAsync(8).catch(() => undefined);
    });
    expect(requestSync).toHaveBeenCalledTimes(3);
  });

  it('syncs after a successful category update and image removal', async () => {
    const category = makeCategory();
    routeFetch([
      { method: 'PATCH', path: '/api/v1/admin/categories/2', reply: () => mockResponse(200, { data: category }) },
      { method: 'DELETE', path: '/api/v1/admin/categories/2/image', reply: () => mockResponse(200, { data: { ...category, image_url: null, image_path: null } }) },
    ]);
    const { result } = await renderHook(() => useCategoryMutations(), { wrapper });

    await act(async () => {
      await result.current.update.mutateAsync({ id: 2, body: { name: 'Breakfast' } });
    });
    await act(async () => {
      await result.current.removeImage.mutateAsync(2);
    });

    await waitFor(() => expect(requestSync).toHaveBeenCalledTimes(2));
  });
});
