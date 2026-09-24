import { router } from 'expo-router';

import {
  api,
  ApiError,
  ApiValidationError,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
} from '@/services/api';
import { saveSession } from '@/services/secureStorage';
import { useSessionStore } from '@/stores/session';
import { cashierUser, flushTimers, installFetchMock, mockResponse, secureStoreMock } from '@/test-utils';

const BASE = 'http://192.168.1.50:8000';
const TOKEN = '1|Xk9f2mQ7vR3tP8wZ1yB5nC6dE0aH4jL2sU7gK9oI';

let fetchMock: jest.Mock;

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  fetchMock = installFetchMock();
  (router.replace as jest.Mock).mockClear();
  useSessionStore.getState().setSignedOut();
});

function lastRequest() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe('api client', () => {
  it('builds the URL from EXPO_PUBLIC_API_URL and attaches Accept + Bearer token', async () => {
    await saveSession(TOKEN, '2026-09-25T01:30:00Z', cashierUser);
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: cashierUser }));

    const result = await api.get<{ data: unknown }>('/api/v1/auth/me');

    const { url, init, headers } = lastRequest();
    expect(url).toBe(`${BASE}/api/v1/auth/me`);
    expect(init.method).toBe('GET');
    expect(headers.Accept).toBe('application/json');
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(result.data).toEqual(cashierUser);
  });

  it('sends Content-Type and a JSON body, and no token when auth is false', async () => {
    await saveSession(TOKEN, '2026-09-25T01:30:00Z', cashierUser);
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: { ok: true } }));

    await api.post('/api/v1/auth/login', { email: 'a@b.c' }, { auth: false });

    const { init, headers } = lastRequest();
    expect(init.method).toBe('POST');
    expect(headers.Accept).toBe('application/json');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBeUndefined();
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.c' }));
  });

  it('returns undefined for a 204', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(204));
    await expect(api.post('/api/v1/auth/logout')).resolves.toBeUndefined();
  });

  it('throws ApiValidationError with the errors map on 422', async () => {
    const body = {
      message: 'The email field is required. (and 1 more error)',
      errors: {
        email: ['The email field is required.'],
        password: ['The password field must be at least 8 characters.'],
      },
    };
    fetchMock.mockResolvedValueOnce(mockResponse(422, body));

    const error = await api.post('/api/v1/auth/login', {}, { auth: false }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiValidationError);
    expect(error).toBeInstanceOf(ApiError);
    const validation = error as ApiValidationError;
    expect(validation.status).toBe(422);
    expect(validation.message).toBe(body.message);
    expect(validation.errors).toEqual(body.errors);
    expect(validation.firstError('email')).toBe('The email field is required.');
    expect(validation.firstError('device_code')).toBeNull();
  });

  it('on 401 clears the stored token and session, and redirects to login once for parallel requests', async () => {
    await saveSession(TOKEN, '2026-09-25T01:30:00Z', cashierUser);
    useSessionStore.getState().setSignedIn(cashierUser, '2026-09-25T01:30:00Z');
    fetchMock.mockResolvedValue(mockResponse(401, { message: 'Unauthenticated.' }));

    const results = await Promise.allSettled([api.get('/api/v1/auth/me'), api.get('/api/v1/auth/me')]);
    await flushTimers();

    for (const result of results) {
      expect(result.status).toBe('rejected');
      const reason = (result as PromiseRejectedResult).reason as ApiError;
      expect(reason).toBeInstanceOf(ApiError);
      expect(reason.status).toBe(401);
    }
    expect(await secureStoreMock().getItemAsync('pos.auth.token')).toBeNull();
    expect(await secureStoreMock().getItemAsync('pos.auth.user')).toBeNull();
    const state = useSessionStore.getState();
    expect(state.status).toBe('signedOut');
    expect(state.user).toBeNull();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  it('does not treat a 401 from an unauthenticated endpoint as a session expiry', async () => {
    useSessionStore.getState().setSignedIn(cashierUser, '2026-09-25T01:30:00Z');
    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Unauthenticated.' }));

    await expect(api.post('/api/v1/auth/login', {}, { auth: false })).rejects.toBeInstanceOf(ApiError);
    await flushTimers();

    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('throws a friendly network error when the server is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    const error = (await api.get('/api/v1/auth/me').catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('network');
    expect(error.status).toBeNull();
    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('throws a friendly timeout error when the request takes too long', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    );

    const error = (await api.get('/api/v1/auth/me', { timeoutMs: 5 }).catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('timeout');
    expect(error.message).toBe(TIMEOUT_ERROR_MESSAGE);
  });

  it("uses the server's message for other errors, with a fallback when there is none", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(429, { message: 'Too Many Attempts.' }));
    const rateLimited = (await api.get('/api/v1/auth/me').catch((e: unknown) => e)) as ApiError;
    expect(rateLimited).toBeInstanceOf(ApiError);
    expect(rateLimited).not.toBeInstanceOf(ApiValidationError);
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.message).toBe('Too Many Attempts.');

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => '<html>oops</html>' });
    const serverError = (await api.get('/api/v1/auth/me').catch((e: unknown) => e)) as ApiError;
    expect(serverError.status).toBe(500);
    expect(serverError.message).toBe('The server had a problem. Please try again.');
  });
});

describe('api base URL', () => {
  const original = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = original;
  });

  it('fails loudly at load time when EXPO_PUBLIC_API_URL is missing', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a fresh require
      expect(() => require('@/services/api')).toThrow(/EXPO_PUBLIC_API_URL is not set/);
    });
  });

  it('strips a trailing slash from the origin', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.50:8000/';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a fresh require
      const { API_BASE_URL } = require('@/services/api') as typeof import('@/services/api');
      expect(API_BASE_URL).toBe(BASE);
    });
  });
});
