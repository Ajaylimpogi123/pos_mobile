import { NETWORK_ERROR_MESSAGE } from '@/services/api';
import { getStoredSession, getUser, saveSession } from '@/services/secureStorage';
import { isExpired, restoreSession, signIn, signOut } from '@/services/session';
import { useSessionStore } from '@/stores/session';
import { cashierUser, flushTimers, installFetchMock, mockResponse, secureStoreMock } from '@/test-utils';

const TOKEN = '1|token';
const NOW = Date.parse('2026-09-24T12:00:00Z');
const FUTURE = '2026-09-25T01:30:00Z';
const PAST = '2026-09-24T01:30:00Z';
/** Written by pre-revision-2 builds; removed at startup. */
const LEGACY_KEY = 'pos.device.code';

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

describe('restoreSession: legacy data from older builds', () => {
  it('deletes the old remembered-code key at startup (best effort)', async () => {
    await secureStoreMock().setItemAsync(LEGACY_KEY, 'TAB01');

    await restoreSession(NOW);

    expect(await secureStoreMock().getItemAsync(LEGACY_KEY)).toBeNull();
    expect(useSessionStore.getState().status).toBe('signedOut');
  });

  it('still restores when deleting the old key fails', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    secureStoreMock().deleteItemAsync.mockRejectedValueOnce(new Error('keystore unavailable'));
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: cashierUser }));

    await restoreSession(NOW);

    expect(useSessionStore.getState().status).toBe('signedIn');
  });

  it('accepts a cached user that still carries the old device object when offline', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    const legacy = { ...cashierUser, device: { id: 1, code: 'TAB01', name: 'Counter Tablet 1' } };
    await secureStoreMock().setItemAsync('pos.auth.user', JSON.stringify(legacy));
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await restoreSession(NOW);

    const state = useSessionStore.getState();
    expect(state.status).toBe('signedIn');
    expect(state.isOffline).toBe(true);
    expect(state.user?.name).toBe(cashierUser.name);
  });

  it('ignores a corrupt cached user instead of crashing', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    await secureStoreMock().setItemAsync('pos.auth.user', JSON.stringify({ id: 'x' }));
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await restoreSession(NOW);

    expect(await getUser()).toBeNull();
    expect(useSessionStore.getState().restoreError).toBe(NETWORK_ERROR_MESSAGE);
  });
});

describe('signIn', () => {
  it('sends only email + password, stores the token, expiry and user, then signs in', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, {
        data: { token: TOKEN, token_type: 'Bearer', expires_at: FUTURE, user: cashierUser },
      }),
    );

    await signIn({ email: ' cashier@pos.test ', password: 'password' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: 'cashier@pos.test', password: 'password' });
    expect(await getStoredSession()).toEqual({ token: TOKEN, expiresAt: FUTURE });
    expect(await getUser()).toEqual(cashierUser);
    expect(useSessionStore.getState().status).toBe('signedIn');
  });

  it('leaves the session untouched when login returns 401', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Invalid email or password.' }));

    await expect(signIn({ email: 'cashier@pos.test', password: 'nope' })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password.',
    });
    expect(useSessionStore.getState().status).toBe('restoring');
    expect(await getStoredSession()).toBeNull();
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

  it('calls POST /auth/logout and clears the stored token and user', async () => {
    await saveSession(TOKEN, FUTURE, cashierUser);
    fetchMock.mockResolvedValueOnce(mockResponse(204));

    await signOut();

    expect(await getStoredSession()).toBeNull();
    expect(await getUser()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.50:8000/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
