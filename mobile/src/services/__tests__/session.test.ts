import { NETWORK_ERROR_MESSAGE } from '@/services/api';
import { getDeviceCode, getStoredSession, getUser, saveSession } from '@/services/secureStorage';
import { isExpired, restoreSession, signIn, signOut } from '@/services/session';
import { useSessionStore } from '@/stores/session';
import { cashierUser, flushTimers, installFetchMock, mockResponse, secureStoreMock } from '@/test-utils';

const TOKEN = '1|token';
const NOW = Date.parse('2026-09-24T12:00:00Z');
const FUTURE = '2026-09-25T01:30:00Z';
const PAST = '2026-09-24T01:30:00Z';

let fetchMock: jest.Mock;

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  fetchMock = installFetchMock();
  useSessionStore.setState({ status: 'restoring', user: null, expiresAt: null, restoreError: null, isOffline: false });
});

describe('isExpired', () => {
  it('treats missing, invalid and past timestamps as expired', () => {
    expect(isExpired(null, NOW)).toBe(true);
    expect(isExpired('not-a-date', NOW)).toBe(true);
    expect(isExpired(PAST, NOW)).toBe(true);
    expect(isExpired(FUTURE, NOW)).toBe(false);
  });
});

describe('restoreSession', () => {
  it('goes to signedOut without calling the API when there is no token', async () => {
    await restoreSession(NOW);

    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('goes to signedOut and clears storage when the token is past expires_at', async () => {
    await saveSession(TOKEN, PAST, cashierUser);

    await restoreSession(NOW);

    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await getStoredSession()).toBeNull();
    expect(await getUser()).toBeNull();
  });

  it('signs in with the fresh user from /auth/me', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    const fresh = { ...cashierUser, name: 'Carla C.' };
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: fresh }));

    await restoreSession(NOW);

    const state = useSessionStore.getState();
    expect(state.status).toBe('signedIn');
    expect(state.user).toEqual(fresh);
    expect(state.expiresAt).toBe(FUTURE);
    expect(state.isOffline).toBe(false);
    expect(await getUser()).toEqual(fresh);
  });

  it('clears the session when /auth/me returns 401', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Unauthenticated.' }));

    await restoreSession(NOW);
    await flushTimers();

    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(useSessionStore.getState().user).toBeNull();
    expect(await getStoredSession()).toBeNull();
    expect(await getUser()).toBeNull();
  });

  it('keeps the cached user when offline instead of signing out', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await restoreSession(NOW);

    const state = useSessionStore.getState();
    expect(state.status).toBe('signedIn');
    expect(state.user).toEqual(cashierUser);
    expect(state.isOffline).toBe(true);
    expect(await getStoredSession()).not.toBeNull();
  });

  it('shows a retryable error when offline with no cached user', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    await secureStoreMock().deleteItemAsync('pos.auth.user');
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await restoreSession(NOW);

    const state = useSessionStore.getState();
    expect(state.status).toBe('restoring');
    expect(state.restoreError).toBe(NETWORK_ERROR_MESSAGE);
    expect(await getStoredSession()).not.toBeNull();
  });
});

describe('signIn', () => {
  it('stores the token, expiry, user and device code, then signs in', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, {
        data: { token: TOKEN, token_type: 'Bearer', expires_at: FUTURE, user: cashierUser },
      }),
    );

    await signIn({ email: ' cashier@pos.test ', password: 'password', deviceCode: 'tab01' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      email: 'cashier@pos.test',
      password: 'password',
      device_code: 'tab01',
      app_version: '1.0.0',
    });
    expect(await getStoredSession()).toEqual({ token: TOKEN, expiresAt: FUTURE });
    expect(await getDeviceCode()).toBe('TAB01');
    expect(useSessionStore.getState().status).toBe('signedIn');
  });
});

describe('signOut', () => {
  it('clears local state even when the logout call fails', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await signOut();

    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(await getStoredSession()).toBeNull();
  });

  it('keeps the remembered device code', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    await secureStoreMock().setItemAsync('pos.device.code', 'TAB01');
    fetchMock.mockResolvedValueOnce(mockResponse(204));

    await signOut();

    expect(await getDeviceCode()).toBe('TAB01');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.50:8000/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
