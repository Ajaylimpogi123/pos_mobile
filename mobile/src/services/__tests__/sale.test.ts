/** Core Sale (Phase 3) service functions: exact URIs, methods, headers and envelopes from the contract. */
import { createStockAdjustment } from '@/services/adminCatalog';
import { listPinUsers, pinLogin } from '@/services/auth';
import { createOrder, getOrder, listOrders } from '@/services/orders';
import { saveSession } from '@/services/secureStorage';
import type { OrderCreateRequest } from '@/services/types';
import { cashierUser, installFetchMock, mockResponse, secureStoreMock } from '@/test-utils';
import { page } from '@/test-utils/catalog';
import { makeOrder, makeOrderSummary, makeStockMovement, PIN_USERS } from '@/test-utils/sale';

const ORIGIN = 'http://192.168.1.50:8000';
const ULID = '01K62Z3K5Q9V7X2M4N6P8R0T1W';

let fetchMock: jest.Mock;

beforeEach(async () => {
  secureStoreMock().__resetSecureStore();
  await saveSession('3|token', '2099-01-01T00:00:00Z', cashierUser);
  fetchMock = installFetchMock();
});

function lastCall(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url, init };
}

describe('orders', () => {
  const body: OrderCreateRequest = {
    ulid: ULID,
    customer_id: null,
    notes: null,
    table_no: '12',
    items: [{ product_id: 4, qty: 1, discount: null, notes: null, sc_pwd: false }],
    discount: null,
    payments: [{ method: 'cash', amount_cents: 10000, reference_no: null }],
    client_total_cents: 8000,
    discount_authorization: null,
    shift_ulid: '01K6S0A1B2C3D4E5F6G7H8J9KM',
    sc_pwd: null,
  };

  it('POST /api/v1/orders sends Idempotency-Key = ulid, JSON, the Bearer token, and returns `data`', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(201, { data: makeOrder() }));

    const order = await createOrder(body);

    const { url, init } = lastCall();
    expect(url).toBe(`${ORIGIN}/api/v1/orders`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer 3|token',
      'Idempotency-Key': ULID,
    });
    expect(JSON.parse(String(init.body))).toEqual(body);
    expect(order.invoice_no).toBe('INV-MAIN-00000042');
  });

  it('GET /api/v1/orders with business_date, search and cursor; GET /api/v1/orders/{ulid}', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, page([makeOrderSummary()], null, '/api/v1/orders')));
    await listOrders({ per_page: 25, business_date: '2026-09-25', search: '42', cursor: 'abc' });
    expect(lastCall().url).toBe(`${ORIGIN}/api/v1/orders?per_page=25&cursor=abc&business_date=2026-09-25&search=42`);

    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: makeOrder() }));
    const order = await getOrder(ULID);
    expect(lastCall().url).toBe(`${ORIGIN}/api/v1/orders/${ULID}`);
    expect(order.ulid).toBe(ULID);
  });
});

describe('PIN quick-switch', () => {
  it('GET /api/v1/auth/pin-users and POST /api/v1/auth/pin (with the current session)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, page(PIN_USERS, null, '/api/v1/auth/pin-users')));
    const users = await listPinUsers();
    expect(lastCall().url).toBe(`${ORIGIN}/api/v1/auth/pin-users`);
    expect(users.data).toHaveLength(3);

    fetchMock.mockResolvedValueOnce(
      mockResponse(200, { data: { token: '7|t', token_type: 'Bearer', expires_at: '2099-01-02T00:00:00Z', user: cashierUser } }),
    );
    const result = await pinLogin({ user_id: 2, pin: '0246' });
    const { url, init } = lastCall();
    expect(url).toBe(`${ORIGIN}/api/v1/auth/pin`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer 3|token');
    // A PIN is a string: leading zeros survive.
    expect(JSON.parse(String(init.body))).toEqual({ user_id: 2, pin: '0246' });
    expect(result.token).toBe('7|t');
  });
});

describe('stock adjustments', () => {
  it('POST /api/v1/admin/products/{id}/stock-adjustments sends Idempotency-Key = ulid', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(201, { data: makeStockMovement() }));

    const movement = await createStockAdjustment(9, { ulid: ULID, counted_qty: 48, reason: 'Count' });

    const { url, init } = lastCall();
    expect(url).toBe(`${ORIGIN}/api/v1/admin/products/9/stock-adjustments`);
    expect(init.headers['Idempotency-Key']).toBe(ULID);
    expect(JSON.parse(String(init.body))).toEqual({ ulid: ULID, counted_qty: 48, reason: 'Count' });
    expect(movement.qty_after).toBe(50);
  });
});
