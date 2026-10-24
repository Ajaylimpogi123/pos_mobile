/**
 * Hardening & Pilot (Phase 8) §G: a soak of the outbox worker.
 *
 * 500 offline sales go through `runOutboxSync` against a mock `/sync/orders`
 * that flaps: timeouts (some after the server already stored the batch),
 * 5xx, 429, partial answers, and an airplane-mode toggle. Halfway through the
 * app "restarts" (a crash after the server stored a batch but before the
 * answer was applied; then a new worker with fresh in-memory state over the
 * same SQLite database).
 *
 * It asserts every sale is delivered **exactly once**: the server stores each
 * ULID once (later copies are `duplicate`), a sale is never sent again once
 * its `accepted`/`duplicate` answer was applied, nothing is lost, and the
 * outbox ends empty with every local order `synced`.
 */
import { offlineRepository } from '@/db/offlineRepository';
import { ApiError } from '@/services/api';
import type { OfflineOrder, PrintableOrder, SyncOrderResult, SyncOrdersRequest } from '@/services/types';
import { freshTestDatabase } from '@/test-utils/database';
import { makeOrder, TEST_SHIFT_ULID } from '@/test-utils/sale';
import { runOutboxSync, type OutboxSyncDeps } from '@/sync/outboxSync';
import { createUlidFactory } from '@/utils/ulid';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const SALES = 500;
const T0 = Date.parse('2026-10-12T01:00:00Z');
let clock = T0;
const nextUlid = createUlidFactory({ now: () => clock });

function iso(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A deterministic PRNG (mulberry32), so the soak is reproducible. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function saveSale(): Promise<string> {
  const ulid = nextUlid();
  clock += 1000;
  await offlineRepository.saveOfflineSale(
    { ulid, deviceCode: 'T01', businessDate: '2026-10-12', branchId: 1, cashierId: 3, shiftUlid: TEST_SHIFT_ULID, now: iso(clock), stockDemand: [] },
    (sequence) => {
      const orderNo = `T01-20261012-${String(sequence).padStart(4, '0')}`;
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

type Fault = 'ok' | 'timeout_before' | 'timeout_after' | '5xx' | '429' | 'partial';

/**
 * The mock server. Idempotent by ULID like the real one: the first copy is
 * `accepted`, every later copy `duplicate`. Records every delivery attempt.
 */
function createServer(random: () => number) {
  const stored = new Map<string, number>();
  const sentCount = new Map<string, number>();
  let calls = 0;

  function pickFault(): Fault {
    const roll = random();
    if (roll < 0.15) return 'timeout_before';
    if (roll < 0.25) return 'timeout_after';
    if (roll < 0.35) return '5xx';
    if (roll < 0.42) return '429';
    if (roll < 0.5) return 'partial';
    return 'ok';
  }

  function store(order: OfflineOrder): SyncOrderResult {
    const already = stored.has(order.ulid);
    stored.set(order.ulid, (stored.get(order.ulid) ?? 0) + 1);
    return {
      ulid: order.ulid,
      status: already ? 'duplicate' : 'accepted',
      order: makeOrder({ ulid: order.ulid, order_no: order.order_no, source: 'offline' }),
      message: null,
    };
  }

  async function send(body: SyncOrdersRequest, fault: Fault = pickFault()): Promise<SyncOrderResult[]> {
    calls += 1;
    for (const order of body.orders) sentCount.set(order.ulid, (sentCount.get(order.ulid) ?? 0) + 1);
    switch (fault) {
      case 'timeout_before':
        throw new ApiError('The server took too long to respond. Please try again.', { status: null, kind: 'timeout' });
      case 'timeout_after':
        // The server stored the batch, but the answer never reached the tablet.
        body.orders.forEach(store);
        throw new ApiError('The server took too long to respond. Please try again.', { status: null, kind: 'timeout' });
      case '5xx':
        throw new ApiError('Server Error.', { status: 503, kind: 'http' });
      case '429':
        throw new ApiError('Too Many Attempts.', { status: 429, kind: 'http' });
      case 'partial': {
        const results = body.orders.map(store);
        return results.slice(0, Math.max(1, Math.floor(results.length / 2)));
      }
      default:
        return body.orders.map(store);
    }
  }

  return {
    send,
    stored,
    sentCount,
    get calls() {
      return calls;
    },
  };
}

beforeEach(async () => {
  await freshTestDatabase();
  clock = T0;
});

it('delivers 500 sales exactly once through a flapping server, an airplane toggle and a restart', async () => {
  const random = prng(20261012);
  const ulids: string[] = [];
  for (let index = 0; index < SALES; index += 1) ulids.push(await saveSale());
  expect(await offlineRepository.countOutbox()).toEqual({ pending: SALES, needsAttention: 0 });

  const server = createServer(random);
  /** ULIDs whose accepted/duplicate answer the tablet applied (its outbox row is gone). */
  const applied = new Set<string>();
  const resentAfterApplied: string[] = [];
  let airplane = false;

  function makeDeps(send: OutboxSyncDeps['send']): OutboxSyncDeps {
    return {
      repository: {
        ...offlineRepository,
        markSynced: async (ulid, order, now) => {
          await offlineRepository.markSynced(ulid, order, now);
          applied.add(ulid);
        },
      },
      send: async (body) => {
        for (const order of body.orders) if (applied.has(order.ulid)) resentAfterApplied.push(order.ulid);
        return send(body);
      },
      sendShiftEvent: async () => undefined,
      register: async () => ({ id: 1, code: 'T01', name: 'Tab', platform: 'android' as const }),
      isOnline: async () => !airplane,
      isSignedIn: () => true,
      prepareDatabase: async () => true,
      now: () => clock,
      random,
    };
  }

  async function drain(deps: OutboxSyncDeps, maxRuns: number, stopWhenSynced?: number): Promise<number> {
    let runs = 0;
    for (; runs < maxRuns; runs += 1) {
      // The airplane toggle: about one run in ten flips the connection.
      if (random() < 0.1) airplane = !airplane;
      const result = await runOutboxSync(deps);
      // Time passes past any backoff (≤ 60 s).
      clock += 61_000;
      const counts = await offlineRepository.countOutbox();
      if (counts.pending === 0 && result.outcome !== 'offline') break;
      if (stopWhenSynced !== undefined && applied.size >= stopWhenSynced) break;
    }
    return runs;
  }

  // First life of the app: run until about half the sales are through.
  await drain(makeDeps((body) => server.send(body)), 1_000, SALES / 2);
  expect(applied.size).toBeGreaterThanOrEqual(SALES / 2);
  expect(applied.size).toBeLessThan(SALES);

  // The crash: the server stores the next batch, then the app dies before applying the answer.
  airplane = false;
  const crashDeps = makeDeps(async (body) => {
    await server.send(body, 'timeout_after').catch(() => undefined);
    throw new Error('process killed');
  });
  // A dead process writes nothing: the batch stays pending exactly as it was.
  const crash: OutboxSyncDeps = { ...crashDeps, repository: { ...crashDeps.repository, deferRows: async () => undefined } };
  const pendingBeforeCrash = (await offlineRepository.countOutbox()).pending;
  await runOutboxSync(crash);
  expect((await offlineRepository.countOutbox()).pending).toBe(pendingBeforeCrash);

  // The restart: a fresh worker (no in-memory state) over the same database.
  airplane = false;
  clock += 5 * 60_000;
  await drain(makeDeps((body) => server.send(body)), 2_000);
  airplane = false;
  // Whatever is left after the last flap goes on a clean connection.
  await drain(makeDeps((body) => server.send(body, 'ok')), 50);

  // Nothing lost.
  expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 0 });
  const synced = await offlineRepository.listLocalOrders({ statuses: ['synced'] });
  expect(synced).toHaveLength(SALES);
  expect(new Set(synced.map((record) => record.ulid))).toEqual(new Set(ulids));

  // Exactly once: every ULID reached the server, it was stored once (copies were duplicates),
  // and the tablet never re-sent a sale after applying its answer.
  expect(server.stored.size).toBe(SALES);
  for (const ulid of ulids) expect(server.stored.has(ulid)).toBe(true);
  expect(applied.size).toBe(SALES);
  expect(resentAfterApplied).toEqual([]);
  // The faults really happened: some sales were sent more than once.
  expect([...server.sentCount.values()].some((count) => count > 1)).toBe(true);
}, 120_000);
