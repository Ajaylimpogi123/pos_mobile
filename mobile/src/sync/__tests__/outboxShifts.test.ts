/**
 * The outbox across entities (docs/api-contract.md → Shifts & Reporting →
 * Device rules → Outbox), against a real SQLite outbox: strictly FIFO
 * (open → sales → cash movement → close), consecutive sales batched, shift
 * events one by one to their endpoints, and a rejected shift event going to
 * Needs attention like a sale.
 */
import { offlineRepository, type ShiftEventEntry } from '@/db/offlineRepository';
import { shiftRepository } from '@/db/shiftRepository';
import { ApiError, ApiValidationError } from '@/services/api';
import type { OfflineOrder, PrintableOrder, SyncOrderResult, SyncOrdersRequest } from '@/services/types';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, routeFetch } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { makeOrder } from '@/test-utils/sale';
import { makeShift } from '@/test-utils/shifts';
import { runOutboxSync, sendShiftEvent, type OutboxSyncDeps } from '@/sync/outboxSync';
import { createUlidFactory } from '@/utils/ulid';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const T0 = Date.parse('2026-09-26T03:00:00Z');
let clock = T0;
const nextUlid = createUlidFactory({ now: () => clock });
const CARLA = { id: 3, name: 'Carla Cashier' };

function iso(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function openShift(): Promise<string> {
  clock += 1000;
  const ulid = nextUlid();
  await shiftRepository.openShift({ ulid, branchId: 1, openedAt: iso(clock), openedBy: CARLA, openingFloatCents: 200000 });
  return ulid;
}

async function cashIn(shiftUlid: string): Promise<string> {
  clock += 1000;
  const ulid = nextUlid();
  await shiftRepository.addCashMovement({
    ulid,
    shiftUlid,
    type: 'in',
    amountCents: 50000,
    reason: 'Change fund',
    occurredAt: iso(clock),
    user: CARLA,
  });
  return ulid;
}

async function closeShift(shiftUlid: string): Promise<string> {
  clock += 1000;
  const eventUlid = nextUlid();
  await shiftRepository.closeShift({
    shiftUlid,
    eventUlid,
    closedAt: iso(clock),
    closedBy: CARLA,
    countedCashCents: 250000,
    closeNote: null,
  });
  return eventUlid;
}

async function saveSale(shiftUlid: string): Promise<string> {
  clock += 1000;
  const ulid = nextUlid();
  await offlineRepository.saveOfflineSale(
    { ulid, deviceCode: 'T01', businessDate: '2026-09-26', branchId: 1, cashierId: 3, shiftUlid, now: iso(clock), stockDemand: [] },
    (sequence) => {
      const orderNo = `T01-20260926-${String(sequence).padStart(4, '0')}`;
      const order: PrintableOrder = { ...makeOrder({ ulid, order_no: orderNo, source: 'offline', shift_ulid: shiftUlid }), invoice_no: null };
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
        shift_ulid: shiftUlid,
        sc_pwd: null,
      };
      return { order, payload };
    },
  );
  return ulid;
}

type Log = string[];

function deps(log: Log, overrides: Partial<OutboxSyncDeps> = {}) {
  const send = jest.fn(async (body: SyncOrdersRequest): Promise<SyncOrderResult[]> => {
    log.push(`orders:${body.orders.map((order) => order.ulid).join(',')}`);
    return body.orders.map((order) => ({ ulid: order.ulid, status: 'accepted', order: makeOrder({ ulid: order.ulid }), message: null }));
  });
  const sendShiftEvent = jest.fn(async (entry: ShiftEventEntry) => {
    log.push(`${entry.entity}:${entry.ulid}`);
  });
  const register = jest.fn(async () => ({ id: 1, code: 'T01', name: 'Tab', platform: 'android' as const }));
  const worker: OutboxSyncDeps = {
    repository: offlineRepository,
    send,
    sendShiftEvent,
    register,
    isOnline: async () => true,
    isSignedIn: () => true,
    prepareDatabase: async () => true,
    now: () => clock,
    random: () => 0.5,
    ...overrides,
  };
  return { worker, send, sendShiftEvent, register };
}

beforeEach(async () => {
  await freshTestDatabase();
  clock = T0;
});

describe('strict FIFO across entities', () => {
  it('open → sales (batched) → cash movement → sale → close, each in its place; everything leaves the outbox', async () => {
    const shift = await openShift();
    const first = await saveSale(shift);
    const second = await saveSale(shift);
    const cash = await cashIn(shift);
    const third = await saveSale(shift);
    const close = await closeShift(shift);
    const log: Log = [];
    const { worker, send } = deps(log);

    const result = await runOutboxSync(worker);

    expect(log).toEqual([
      `shift_open:${shift}`,
      `orders:${first},${second}`,
      `cash_movement:${cash}`,
      `orders:${third}`,
      `shift_close:${close}`,
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ outcome: 'done', sent: 6, synced: 6, rejected: 0 });
    expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 0 });
    expect((await offlineRepository.getLocalOrder(third))?.status).toBe('synced');
  });

  it('nextBatch stops a run of sales at the next shift event, and returns a shift event alone', async () => {
    const shift = await openShift();
    const sale = await saveSale(shift);
    await cashIn(shift);
    const far = '2999-01-01T00:00:00Z';

    const [open] = await offlineRepository.nextBatch(50, far, false);
    expect(open).toMatchObject({ entity: 'shift_open', ulid: shift });
    expect(open.payload).toMatchObject({ shift_ulid: shift, body: { ulid: shift, opened_by: 3, opening_float_cents: 200000 } });
    await offlineRepository.completeShiftEvent(shift);

    const orders = await offlineRepository.nextBatch(50, far, false);
    expect(orders.map((entry) => [entry.entity, entry.ulid])).toEqual([['order', sale]]);
  });

  it('a shift event backing off (network) holds back everything behind it', async () => {
    const shift = await openShift();
    const sale = await saveSale(shift);
    const log: Log = [];
    const { worker, sendShiftEvent, send } = deps(log);
    sendShiftEvent.mockRejectedValueOnce(new ApiError("Can't reach the server.", { status: null, kind: 'network' }));

    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'error', retryAt: iso(clock + 1_000) });
    expect(send).not.toHaveBeenCalled();
    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'done', sent: 0 });

    clock += 1_000;
    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'done', synced: 2 });
    expect(log).toEqual([`shift_open:${shift}`, `orders:${sale}`]);
  });
});

describe('results of a shift event', () => {
  it('a rejected shift event (422) goes to Needs attention with the message; the rows behind it carry on; Retry re-queues it', async () => {
    const shift = await openShift();
    const cash = await cashIn(shift);
    const sale = await saveSale(shift);
    const log: Log = [];
    const { worker, sendShiftEvent } = deps(log);
    sendShiftEvent.mockImplementation(async (entry: ShiftEventEntry) => {
      log.push(`${entry.entity}:${entry.ulid}`);
      if (entry.entity === 'cash_movement') {
        throw new ApiValidationError('The selected user id is invalid.', { user_id: ['The selected user id is invalid.'] });
      }
    });

    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'done', synced: 2, rejected: 1 });
    expect(log).toEqual([`shift_open:${shift}`, `cash_movement:${cash}`, `orders:${sale}`]);
    expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 1 });
    const [event] = await offlineRepository.listShiftEvents();
    expect(event).toMatchObject({ ulid: cash, entity: 'cash_movement', status: 'needs_attention', shiftUlid: shift });
    expect(event.lastError).toBe('The selected user id is invalid.');

    expect(await offlineRepository.requeue(cash, iso(clock))).toBe(true);
    sendShiftEvent.mockImplementation(async () => undefined);
    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'done', synced: 1 });
    expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 0 });
  });

  it('409 "Register this tablet first." registers, then sends again; "This shift belongs to another tablet." is a rejection', async () => {
    const shift = await openShift();
    const cash = await cashIn(shift);
    const log: Log = [];
    const { worker, sendShiftEvent, register } = deps(log);
    sendShiftEvent
      .mockRejectedValueOnce(new ApiError('Register this tablet first.', { status: 409, kind: 'http' }))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError('This shift belongs to another tablet.', { status: 409, kind: 'http' }));

    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'done', synced: 1, rejected: 1 });
    expect(register).toHaveBeenCalledTimes(1);
    const [event] = await offlineRepository.listShiftEvents();
    expect(event).toMatchObject({ ulid: cash, status: 'needs_attention', lastError: 'This shift belongs to another tablet.' });
  });

  it('401 stops and keeps the event; a 5xx backs off', async () => {
    const shift = await openShift();
    const log: Log = [];
    const { worker, sendShiftEvent } = deps(log);
    sendShiftEvent.mockRejectedValueOnce(new ApiError('Your session has ended.', { status: 401, kind: 'http' }));
    expect(await runOutboxSync(worker)).toEqual({ outcome: 'stopped' });
    sendShiftEvent.mockRejectedValueOnce(new ApiError('Server Error.', { status: 500, kind: 'http' }));
    expect(await runOutboxSync(worker)).toMatchObject({ outcome: 'error' });
    expect(await offlineRepository.countOutbox()).toEqual({ pending: 1, needsAttention: 0 });
    const [entry] = await offlineRepository.nextBatch(50, '2999-01-01T00:00:00Z', false);
    expect(entry).toMatchObject({ ulid: shift, attempts: 1 });
  });
});

describe('sendShiftEvent: each event to its endpoint, with the contract body (no Idempotency-Key)', () => {
  beforeEach(() => {
    secureStoreMock().__resetSecureStore();
  });

  it('POST /shifts, POST /shifts/{ulid}/cash-movements, POST /shifts/{ulid}/close', async () => {
    const shift = await openShift();
    await cashIn(shift);
    await closeShift(shift);
    const { calls } = routeFetch([
      { method: 'POST', path: '/api/v1/shifts', reply: () => mockResponse(201, { data: makeShift({ ulid: shift, status: 'open' }) }) },
      {
        method: 'POST',
        path: `/api/v1/shifts/${shift}/cash-movements`,
        reply: () =>
          mockResponse(201, { data: { ulid: 'X', type: 'in', amount_cents: 50000, reason: 'Change fund', occurred_at: iso(clock), user: CARLA } }),
      },
      { method: 'POST', path: `/api/v1/shifts/${shift}/close`, reply: () => mockResponse(200, { data: makeShift({ ulid: shift }) }) },
    ]);

    for (;;) {
      const [entry] = await offlineRepository.nextBatch(50, '2999-01-01T00:00:00Z', true);
      if (!entry || entry.entity === 'order') break;
      await sendShiftEvent(entry);
      await offlineRepository.completeShiftEvent(entry.ulid);
    }

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/v1/shifts',
      `POST /api/v1/shifts/${shift}/cash-movements`,
      `POST /api/v1/shifts/${shift}/close`,
    ]);
    expect(jsonBody(calls[0])).toEqual({ ulid: shift, opened_at: iso(T0 + 1000), opened_by: 3, opening_float_cents: 200000 });
    expect(jsonBody(calls[1])).toMatchObject({ type: 'in', amount_cents: 50000, reason: 'Change fund', user_id: 3 });
    expect(Object.keys(jsonBody(calls[1]) as object).sort()).toEqual(['amount_cents', 'occurred_at', 'reason', 'type', 'ulid', 'user_id']);
    expect(jsonBody(calls[2])).toEqual({ closed_at: iso(T0 + 3000), closed_by: 3, counted_cash_cents: 250000, close_note: null });
    for (const call of calls) expect(call.init.headers).not.toHaveProperty('Idempotency-Key');
  });
});
