/**
 * Server reachability (Offline Sales hardening): the shared client marks the
 * server reachable on any HTTP response and unreachable on a network error or
 * timeout; `probeServer()` asks `GET /up` (no token, 3 s); and the request
 * timeouts of `POST /orders` (8 s) and `POST /sync/orders` (30 s).
 */
import { act } from '@testing-library/react-native';

import { api, isApiError, probeServer, PROBE_TIMEOUT_MS } from '@/services/api';
import { createOrder, CREATE_ORDER_TIMEOUT_MS } from '@/services/orders';
import { syncOrders, SYNC_ORDERS_TIMEOUT_MS } from '@/services/sync';
import type { OrderCreateRequest } from '@/services/types';
import { useConnectivityStore } from '@/stores/connectivity';
import { installFetchMock, mockResponse, secureStoreMock } from '@/test-utils';

let fetchMock: jest.Mock;

/** A fetch that never answers until it is aborted. */
function hang(_input: string, init: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  });
}

/** The request timer starts after the client reads the token: let it reach fetch first. */
async function untilFetched(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 50 && fetchMock.mock.calls.length === 0; tick += 1) await Promise.resolve();
  });
}

function reachable(): boolean {
  return useConnectivityStore.getState().serverReachable;
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useConnectivityStore.getState().reset();
  fetchMock = installFetchMock();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the API client marks reachability', () => {
  it('a network error marks the server unreachable; any HTTP answer marks it reachable again', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(api.get('/api/v1/auth/me')).rejects.toMatchObject({ kind: 'network' });
    expect(reachable()).toBe(false);

    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: {} }));
    await api.get('/api/v1/auth/me');
    expect(reachable()).toBe(true);
  });

  it.each([
    [422, { message: 'The given data was invalid.', errors: { note: ['Too long.'] } }],
    [500, { message: 'Server Error.' }],
    [404, { message: 'Resource not found.' }],
    [409, { message: "This order doesn't need review." }],
  ])('an HTTP %i is still an answer: the server stays reachable', async (status, body) => {
    useConnectivityStore.getState().setServerReachable(false);
    fetchMock.mockResolvedValueOnce(mockResponse(status, body));
    await expect(api.post('/api/v1/orders/X/review', { note: null })).rejects.toBeTruthy();
    expect(reachable()).toBe(true);
  });

  it('a timeout marks the server unreachable', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(hang);
    const request = api.get('/api/v1/sync/stock', { timeoutMs: 1_000 }).catch((error: unknown) => error);
    await untilFetched();
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    const error = await request;
    expect(isApiError(error) && error.kind).toBe('timeout');
    expect(reachable()).toBe(false);
  });
});

describe('probeServer', () => {
  it('GET /up without a token: any HTTP answer means reachable', async () => {
    await secureStoreMock().setItemAsync('pos.auth.token', 'secret-token');
    useConnectivityStore.getState().setServerReachable(false);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<html>OK</html>' } as unknown as Response);

    expect(await probeServer()).toBe(true);
    expect(reachable()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.168.1.50:8000/up');
    expect(init.method).toBe('GET');
    expect(init.headers).not.toHaveProperty('Authorization');

    useConnectivityStore.getState().setServerReachable(false);
    fetchMock.mockResolvedValueOnce(mockResponse(503, { message: 'Service Unavailable' }));
    expect(await probeServer()).toBe(true);
    expect(reachable()).toBe(true);
  });

  it('no answer within 3 s, or a network error: unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await probeServer()).toBe(false);
    expect(reachable()).toBe(false);

    jest.useFakeTimers();
    fetchMock.mockImplementation(hang);
    fetchMock.mockClear();
    const probe = probeServer();
    await untilFetched();
    await act(async () => {
      jest.advanceTimersByTime(PROBE_TIMEOUT_MS);
    });
    expect(await probe).toBe(false);
    expect(PROBE_TIMEOUT_MS).toBe(3_000);
  });
});

describe('request timeouts', () => {
  async function timesOutAfter(start: () => Promise<unknown>, timeoutMs: number) {
    jest.useFakeTimers();
    fetchMock.mockImplementation(hang);
    let settled: unknown = 'pending';
    void start().catch((error: unknown) => {
      settled = error;
    });
    await untilFetched();
    await act(async () => {
      jest.advanceTimersByTime(timeoutMs - 1);
    });
    expect(settled).toBe('pending');
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(isApiError(settled) && settled.kind).toBe('timeout');
  }

  it('POST /orders: 8 s', async () => {
    expect(CREATE_ORDER_TIMEOUT_MS).toBe(8_000);
    const body = { ulid: '01K62Z3K5Q9V7X2M4N6P8R0T1W' } as OrderCreateRequest;
    await timesOutAfter(() => createOrder(body), CREATE_ORDER_TIMEOUT_MS);
  });

  it('POST /sync/orders: 30 s', async () => {
    expect(SYNC_ORDERS_TIMEOUT_MS).toBe(30_000);
    await timesOutAfter(() => syncOrders({ orders: [] }), SYNC_ORDERS_TIMEOUT_MS);
  });
});
