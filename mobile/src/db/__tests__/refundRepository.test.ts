/**
 * Voids & Refunds (Phase 7) → Local data: `local_refunds` (stored once,
 * listed per shift, pruned like synced sales) and the replacement of a
 * stored sale's server `Order` after a void or a refund.
 */
import { offlineRepository } from '@/db/offlineRepository';
import { refundRepository } from '@/db/refundRepository';
import { freshTestDatabase } from '@/test-utils/database';
import { makeOrder, makeRefund, makeVoidedOrder, TEST_SHIFT_ULID } from '@/test-utils/sale';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

const OLD_SHIFT = '01K6S00000000000000000000P';

beforeEach(async () => {
  await freshTestDatabase();
});

describe('local_refunds', () => {
  it('stores a refund once (a replayed 201 writes nothing) and lists a shift\'s refunds oldest first', async () => {
    const first = makeRefund({ ulid: '01K6R00000000000000000000A' });
    const second = makeRefund({ ulid: '01K6R00000000000000000000B', amount_cents: 6738 });
    expect(await refundRepository.saveRefund('O1', first, '2026-09-27T05:10:00Z')).toBe(true);
    expect(await refundRepository.saveRefund('O1', first, '2026-09-27T05:10:01Z')).toBe(false);
    await refundRepository.saveRefund('O1', second, '2026-09-27T06:00:00Z');
    await refundRepository.saveRefund('O2', makeRefund({ ulid: '01K6R00000000000000000000C', shift_ulid: OLD_SHIFT }), '2026-09-27T06:00:00Z');

    const records = await refundRepository.listForShift(TEST_SHIFT_ULID);
    expect(records.map((record) => [record.ulid, record.refund.amount_cents])).toEqual([
      [first.ulid, 3369],
      [second.ulid, 6738],
    ]);
  });

  it('prunes refunds older than the cutoff, except those of the current shift', async () => {
    await refundRepository.saveRefund('O1', makeRefund({ ulid: '01K6R00000000000000000000A', shift_ulid: OLD_SHIFT }), '2026-09-01T00:00:00Z');
    await refundRepository.saveRefund('O2', makeRefund({ ulid: '01K6R00000000000000000000B' }), '2026-09-01T00:00:00Z');
    await refundRepository.saveRefund('O3', makeRefund({ ulid: '01K6R00000000000000000000C', shift_ulid: OLD_SHIFT }), '2026-09-27T00:00:00Z');
    expect(await refundRepository.pruneRefunds('2026-09-20T00:00:00Z', TEST_SHIFT_ULID)).toBe(1);
    expect((await refundRepository.listForShift(OLD_SHIFT)).map((record) => record.ulid)).toEqual(['01K6R00000000000000000000C']);
    expect(await refundRepository.listForShift(TEST_SHIFT_ULID)).toHaveLength(1);
  });
});

describe('replaceServerOrder', () => {
  const draft = { branchId: 1, shiftUlid: TEST_SHIFT_ULID, now: '2026-09-25T04:12:10Z' };

  it('an online sale: both stored copies become the voided Order', async () => {
    await offlineRepository.saveSyncedSale(makeOrder(), draft);
    expect(await offlineRepository.replaceServerOrder(makeVoidedOrder(), '2026-09-25T04:20:00Z')).toBe(true);
    const record = await offlineRepository.getLocalOrder(makeOrder().ulid);
    expect(record?.order.status).toBe('voided');
    expect(record?.serverOrder?.status).toBe('voided');
  });

  it('a synced offline sale keeps its local printable order; the tablet without the sale changes nothing', async () => {
    const offline = makeOrder({ order_no: 'T01-20260925-0001', source: 'offline' });
    await offlineRepository.saveSyncedSale(offline, draft);
    await offlineRepository.replaceServerOrder({ ...offline, status: 'voided' }, '2026-09-25T04:20:00Z');
    const record = await offlineRepository.getLocalOrder(offline.ulid);
    expect(record?.order.status).toBe('completed');
    expect(record?.serverOrder?.status).toBe('voided');

    expect(await offlineRepository.replaceServerOrder(makeOrder({ ulid: '01K62Y0000000000000000000A' }), '2026-09-25T04:20:00Z')).toBe(false);
  });
});
