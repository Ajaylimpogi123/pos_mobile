/**
 * The outbox worker (docs/api-contract.md → Offline Sales → Device rules →
 * Sync worker) against a real SQLite outbox: FIFO, batches of ≤ 50, backoff
 * with jitter, and every result: accepted / duplicate (synced, removed),
 * rejected (needs attention, kept, Retry), 409 (register, then retry), 401
 * (stop, keep the outbox).
 */
import { offlineRepository } from '@/db/offlineRepository';
import { ApiError } from '@/services/api';
import type { OfflineOrder, PrintableOrder, SyncOrderResult, SyncOrdersRequest } from '@/services/types';
import { freshTestDatabase } from '@/test-utils/database';
import { makeOrder, TEST_SHIFT_ULID } from '@/test-utils/sale';
import {
  backoffDelay,
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  MISSING_RESULT_MESSAGE,
  runOutboxSync,
  type OutboxSyncDeps,
} from '@/sync/outboxSync';
import { createUlidFactory } from '@/utils/ulid';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const T0 = Date.parse('2026-09-26T03:00:00Z');
let clock = T0;
const nextUlid = createUlidFactory({ now: () => clock });

function iso(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Stores one offline sale (local order + outbox row) the way the checkout does. */
async function saveSale(ulid = nextUlid()): Promise<string> {
  clock += 1000;
  await offlineRepository.saveOfflineSale(
    { ulid, deviceCode: 'T01', businessDate: '2026-09-26', branchId: 1, cashierId: 3, shiftUlid: TEST_SHIFT_ULID, now: iso(clock), stockDemand: [] },
    (sequence) => {
      const orderNo = `T01-20260926-${String(sequence).padStart(4, '0')}`;
      const order: PrintableOrder = { ...makeOrder({ ulid, order_no: orderNo, source: 'offline' }), invoice_no: null };
      const payload: OfflineOrder = {
        ulid,
        customer_id: null,
        notes: null,
        table_no: null,
        items: [{ product_id: 9, qty: 1, discount: null, notes: null, sc_pwd: false, unit_price_cents: 3500 }],
        discount: null,
        payments: [{ method: 'cash', amount_cents: 3500, reference_no: null }],
        client_total_cents: 3500,
        order_no: orderNo,
        placed_at: iso(clock),
        cashier_id: 3,
        shift_ulid: TEST_SHIFT_ULID,
        sc_pwd: null,
      };
      return { order, payload };
    },
  );
  return ulid;
}

function accepted(ulid: string, status: 'accepted' | 'duplicate' = 'accepted'): SyncOrderResult {
  return { ulid, status, order: makeOrder({ ulid, source: 'offline' }), message: null };
}

function acceptAll(body: SyncOrdersRequest): SyncOrderResult[] {
  return body.orders.map((order) => accepted(order.ulid));
}

function deps(overrides: Partial<OutboxSyncDeps> = {}): OutboxSyncDeps & { send: jest.Mock; register: jest.Mock } {
  return {
    repository: offlineRepository,
    send: jest.fn(async (body: SyncOrdersRequest) => acceptAll(body)),
    register: jest.fn(async () => ({ id: 1, code: 'T01', name: 'Tab' })),
    isOnline: async () => true,
    isSignedIn: () => true,
    prepareDatabase: async () => true,
    now: () => clock,
    random: () => 0.5,
    ...overrides,
  } as OutboxSyncDeps & { send: jest.Mock; register: jest.Mock };
}

function sentUlids(send: jest.Mock, call: number): string[] {
  return (send.mock.calls[call][0] as SyncOrdersRequest).orders.map((order) => order.ulid);
}

beforeEach(async () => {
  await freshTestDatabase();
  clock = T0;
});

describe('batches', () => {
  it('sends FIFO (oldest first), 51 sales as 50 + 1, and removes every synced row', async () => {
    const ulids: string[] = [];
    for (let index = 0; index < 51; index += 1) ulids.push(await saveSale());
    const worker = deps();

    const result = await runOutboxSync(worker);

    expect(result).toMatchObject({ outcome: 'done', sent: 51, synced: 51, rejected: 0 });
    expect(worker.send).toHaveBeenCalledTimes(2);
    expect(sentUlids(worker.send, 0)).toEqual(ulids.slice(0, 50));
    expect(sentUlids(worker.send, 1)).toEqual([ulids[50]]);
    expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 0 });
  });

  it('sends the OfflineOrder exactly as stored (no discount_authorization)', async () => {
    const ulid = await saveSale();
    const worker = deps();
    await runOutboxSync(worker);

    const [order] = (worker.send.mock.calls[0][0] as SyncOrdersRequest).orders;
    expect(order).toMatchObject({ ulid, order_no: 'T01-20260926-0001', cashier_id: 3 });
    expect(order.items[0].unit_price_cents).toBe(3500);
    expect(order).not.toHaveProperty('discount_authorization');
  });

  it('does nothing while offline or signed out (the outbox is kept)', async () => {
    await saveSale();
    const offline = deps({ isOnline: async () => false });
    expect(await runOutboxSync(offline)).toEqual({ outcome: 'offline' });
    const signedOut = deps({ isSignedIn: () => false });
    expect(await runOutboxSync(signedOut)).toEqual({ outcome: 'stopped' });
    expect(offline.send).not.toHaveBeenCalled();
    expect(signedOut.send).not.toHaveBeenCalled();
    expect((await offlineRepository.countOutbox()).pending).toBe(1);
  });
});

describe('results', () => {
  it('accepted and duplicate: the local order is synced with the server Order; the outbox row goes', async () => {
    const first = await saveSale();
    const second = await saveSale();
    const worker = deps({ send: jest.fn(async () => [accepted(first), accepted(second, 'duplicate')]) });

    await runOutboxSync(worker);

    for (const ulid of [first, second]) {
      const record = await offlineRepository.getLocalOrder(ulid);
      expect(record?.status).toBe('synced');
      expect(record?.serverOrder?.invoice_no).toBe('INV-MAIN-00000042');
    }
    expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 0 });
  });

  it("rejected: needs attention with the message, never deleted; Retry re-queues it at its place", async () => {
    const bad = await saveSale();
    const good = await saveSale();
    const worker = deps({
      send: jest.fn(async (body: SyncOrdersRequest) =>
        body.orders.map((order) =>
          order.ulid === bad ? { ulid: bad, status: 'rejected' as const, order: null, message: "Product 999 doesn't exist." } : accepted(order.ulid),
        ),
      ),
    });

    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'done', synced: 1, rejected: 1 });
    const rejected = await offlineRepository.getLocalOrder(bad);
    expect(rejected).toMatchObject({ status: 'needs_attention', lastError: "Product 999 doesn't exist." });
    expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 1 });

    // Not sent again on its own.
    worker.send.mockClear();
    await runOutboxSync(worker);
    expect(worker.send).not.toHaveBeenCalled();

    // Retry: pending again, and the next run sends it.
    expect(await offlineRepository.requeue(bad, iso(clock))).toBe(true);
    expect((await offlineRepository.getLocalOrder(bad))?.status).toBe('pending');
    worker.send.mockImplementation(async (body: SyncOrdersRequest) => acceptAll(body));
    await runOutboxSync(worker);
    expect(sentUlids(worker.send, 0)).toEqual([bad]);
    expect((await offlineRepository.getLocalOrder(bad))?.status).toBe('synced');
    expect((await offlineRepository.getLocalOrder(good))?.status).toBe('synced');
  });

  it('409 "Register this tablet first.": registers the device, then sends the batch again', async () => {
    const ulid = await saveSale();
    const send = jest
      .fn()
      .mockRejectedValueOnce(new ApiError('Register this tablet first.', { status: 409, kind: 'http' }))
      .mockImplementation(async (body: SyncOrdersRequest) => acceptAll(body));
    const worker = deps({ send });

    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'done', synced: 1 });
    expect(worker.register).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect((await offlineRepository.getLocalOrder(ulid))?.status).toBe('synced');
  });

  it('409 again after registering: backs off instead of looping', async () => {
    await saveSale();
    const send = jest.fn().mockRejectedValue(new ApiError('Register this tablet first.', { status: 409, kind: 'http' }));
    const worker = deps({ send });

    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'error' });
    expect(worker.register).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect((await offlineRepository.countOutbox()).pending).toBe(1);
  });

  it('401: stops and keeps the outbox untouched (no backoff) until someone signs in', async () => {
    const ulid = await saveSale();
    const worker = deps({ send: jest.fn().mockRejectedValue(new ApiError('Your session has ended.', { status: 401, kind: 'http' })) });

    expect(await runOutboxSync(worker)).toEqual({ outcome: 'stopped' });
    expect((await offlineRepository.getLocalOrder(ulid))?.status).toBe('pending');
    const [entry] = await offlineRepository.nextBatch(50, iso(clock), false);
    expect(entry).toMatchObject({ ulid, attempts: 0 });
  });
});

describe('backoff', () => {
  it('grows 1 s → 60 s with jitter, never outside 1–60 s', () => {
    expect(backoffDelay(1, () => 0.5)).toBe(1_000);
    expect(backoffDelay(2, () => 0.5)).toBe(2_000);
    expect(backoffDelay(3, () => 0.5)).toBe(4_000);
    expect(backoffDelay(20, () => 0.5)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(3, () => 0)).toBe(3_000);
    expect(backoffDelay(3, () => 1)).toBe(5_000);
    for (const attempts of [1, 2, 5, 8, 30]) {
      for (const random of [0, 0.3, 0.99]) {
        const delay = backoffDelay(attempts, () => random);
        expect(delay).toBeGreaterThanOrEqual(BACKOFF_MIN_MS);
        expect(delay).toBeLessThanOrEqual(BACKOFF_MAX_MS);
      }
    }
  });

  it('a network error or 5xx defers the batch; nothing is sent until it is due; "Sync now" (force) sends at once', async () => {
    const ulid = await saveSale();
    const send = jest.fn().mockRejectedValueOnce(new ApiError("Can't reach the server.", { status: null, kind: 'network' }));
    const worker = deps({ send });

    const failed = await runOutboxSync(worker);
    expect(failed).toMatchObject({ outcome: 'error', retryAt: iso(clock + 1_000) });

    // A newer sale can't overtake the one backing off (FIFO).
    await saveSale();
    clock -= 1000; // still before the retry time
    send.mockClear();
    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'done', sent: 0, retryAt: iso(T0 + 2_000) });
    expect(send).not.toHaveBeenCalled();

    // A 5xx backs off longer (attempts 2 → 2 s).
    send.mockRejectedValueOnce(new ApiError('Server Error.', { status: 500, kind: 'http' }));
    const forced = await runOutboxSync(worker, { force: true });
    expect(forced).toMatchObject({ outcome: 'error', retryAt: iso(clock + 2_000) });
    expect(sentUlids(send, 0)[0]).toBe(ulid);

    // Once due, both go, oldest first.
    clock += 2_000;
    send.mockImplementation(async (body: SyncOrdersRequest) => acceptAll(body));
    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'done', synced: 2 });
    expect(sentUlids(send, 1)[0]).toBe(ulid);
  });

  it('results that are not a list (e.g. null): nothing is synced, every sale is deferred with MISSING_RESULT_MESSAGE', async () => {
    const first = await saveSale();
    const second = await saveSale();
    const worker = deps({ send: jest.fn(async () => null as unknown as SyncOrderResult[]) });

    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'error', synced: 0, retryAt: iso(clock + 1_000) });
    for (const ulid of [first, second]) expect((await offlineRepository.getLocalOrder(ulid))?.status).toBe('pending');
    const batch = await offlineRepository.nextBatch(50, iso(clock + 1_000), false);
    expect(batch.map((entry) => [entry.ulid, entry.attempts])).toEqual([
      [first, 1],
      [second, 1],
    ]);
    expect(await offlineRepository.nextAttemptAt()).toBe(iso(clock + 1_000));
    const db = jest.requireActual<typeof import('@/test-utils/database')>('@/test-utils/database').currentTestDatabase();
    const errors = await db.query.outbox.findMany({ columns: { last_error: true } });
    expect(errors.map((row) => row.last_error)).toEqual([MISSING_RESULT_MESSAGE, MISSING_RESULT_MESSAGE]);
  });

  it('a sale the server left out of the results is sent again later; the others are synced', async () => {
    const first = await saveSale();
    const second = await saveSale();
    const worker = deps({ send: jest.fn(async () => [accepted(first)]) });

    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'error', synced: 1 });
    expect((await offlineRepository.getLocalOrder(first))?.status).toBe('synced');
    expect((await offlineRepository.getLocalOrder(second))?.status).toBe('pending');
  });
});
