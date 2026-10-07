/**
 * Offline sales on the tablet (docs/api-contract.md → Offline Sales → Device
 * rules → Local write): the daily `order_no` (business-day rollover, a
 * restart), the printable local order and the `OfflineOrder` built from the
 * same pricing, the advisory stock decrement, and crash safety: the local
 * order and its outbox row are written in one transaction or not at all.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { offlineRepository } from '@/db/offlineRepository';
import { readCategoryNames } from '@/db/menuQueries';
import { catalogueRepository } from '@/db/catalogueRepository';
import { buildKitchenTicket } from '@/printing/documents/kitchenTicket';
import { buildReceipt } from '@/printing/documents/receipt';
import {
  buildLocalOrder,
  buildOfflineOrder,
  formatOrderNo,
  orderNumberLabel,
  parseOrderNo,
  settlePayments,
  shortOrderNumber,
  ticketNumberLabel,
} from '@/sale/localOrder';
import { saveOfflineSale, stockDemand, type OfflineSaleDeps, type OfflineSaleInput } from '@/sale/offlineSale';
import { priceCart } from '@/sale/order';
import type { CachedDevice } from '@/services/secureStorage';
import { resetCart, useCartStore } from '@/stores/cart';
import { cashierUser } from '@/test-utils';
import { freshTestDatabase } from '@/test-utils/database';
import { printedLines } from '@/test-utils/escpos';
import { makeSettings } from '@/test-utils/printing';
import { fillCartWithExampleB, TEST_SHIFT_ULID } from '@/test-utils/sale';
import { seedMenu } from '@/test-utils/sync';
import { createUlidFactory } from '@/utils/ulid';

/** Set by the "restart" test: the database reopened by freshly loaded modules. */
let mockReopenedDb: unknown = null;

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => mockReopenedDb ?? require('@/test-utils/database').currentTestDatabase(),
}));

/** The expo-sqlite connection under the test database (Drizzle keeps it as `$client`, untyped on `AppDatabase`). */
function connectionOf(): SQLiteDatabase {
  const database = jest.requireActual<typeof import('@/test-utils/database')>('@/test-utils/database').currentTestDatabase();
  return (database as unknown as { $client: SQLiteDatabase }).$client;
}

const DEVICE: CachedDevice = { id: 1, code: 'T01', apiOrigin: 'http://192.168.1.50:8000', branchId: 1 };
/** 2026-09-26 10:00 in Manila (UTC+8), well inside the business day that started at 04:00. */
const MORNING = Date.parse('2026-09-26T02:00:00Z');
const nextUlid = createUlidFactory();

function deps(overrides: Partial<OfflineSaleDeps> = {}): OfflineSaleDeps {
  return {
    device: async () => DEVICE,
    prepareDatabase: async () => true,
    repository: offlineRepository,
    categoryNames: readCategoryNames,
    afterSave: jest.fn(),
    ...overrides,
  };
}

function exampleB(now: number, ulid = nextUlid()): OfflineSaleInput {
  const cart = useCartStore.getState();
  return {
    ulid,
    lines: cart.lines,
    orderDiscount: cart.orderDiscount,
    customer: { id: 12, full_name: 'Maria Santos' },
    tableNo: '12',
    shiftUlid: TEST_SHIFT_ULID,
    payments: [
      { method: 'gcash', amount_cents: 10000, reference_no: '1012345678901' },
      { method: 'cash', amount_cents: 20000, reference_no: null },
    ],
    pricing: priceCart(cart.lines, cart.orderDiscount),
    user: cashierUser,
    scPwd: null,
    now,
  };
}

async function save(now: number, ulid?: string): Promise<string> {
  const outcome = await saveOfflineSale(exampleB(now, ulid), deps());
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.order.order_no ?? '';
}

beforeEach(async () => {
  await freshTestDatabase();
  const menu = seedMenu();
  await catalogueRepository.replaceCatalogue(menu, { cursor: 'c1', apiOrigin: DEVICE.apiOrigin, serverTime: '2026-09-26T00:00:00Z' });
  resetCart();
  fillCartWithExampleB();
});

describe('order_no', () => {
  it('formats, parses and shortens the device number', () => {
    expect(formatOrderNo('T01', '2026-09-26', 5)).toBe('T01-20260926-0005');
    expect(formatOrderNo('T123', '2026-09-26', 12345)).toBe('T123-20260926-12345');
    expect(parseOrderNo('T01-20260926-0005')).toEqual({ deviceCode: 'T01', date: '2026-09-26', sequence: 5 });
    expect(parseOrderNo('bad')).toBeNull();
    expect(shortOrderNumber('T01-20260926-0005')).toBe('T01-5');
    expect(() => formatOrderNo('t-1', '2026-09-26', 1)).toThrow();
    expect(() => formatOrderNo('T01', '2026-09-26', 0)).toThrow();
  });

  it('counts per business day: the day rolls over at 04:00 branch time, not at midnight', async () => {
    expect(await save(MORNING)).toBe('T01-20260926-0001');
    expect(await save(MORNING + 60_000)).toBe('T01-20260926-0002');
    // 02:30 on the 27th in Manila is still the 26th's business day.
    expect(await save(Date.parse('2026-09-26T18:30:00Z'))).toBe('T01-20260926-0003');
    // 04:00 on the 27th: a new business day starts at 1.
    expect(await save(Date.parse('2026-09-26T20:00:00Z'))).toBe('T01-20260927-0001');
    expect(await save(Date.parse('2026-09-26T21:00:00Z'))).toBe('T01-20260927-0002');
  });

  it('survives a restart: the counter lives in SQLite, not in memory', async () => {
    expect(await save(MORNING)).toBe('T01-20260926-0001');
    expect(await save(MORNING + 1_000)).toBe('T01-20260926-0002');
    // A restart: new modules (nothing kept in memory), and a new connection object on the same database.
    const connection = connectionOf();
    await jest.isolateModulesAsync(async () => {
      const { drizzle } = jest.requireActual<typeof import('drizzle-orm/expo-sqlite')>('drizzle-orm/expo-sqlite');
      const schema = jest.requireActual<typeof import('@/db/schema')>('@/db/schema');
      mockReopenedDb = drizzle(connection, { schema });
      const fresh = jest.requireActual<typeof import('@/sale/offlineSale')>('@/sale/offlineSale');
      const repository = jest.requireActual<typeof import('@/db/offlineRepository')>('@/db/offlineRepository');
      const outcome = await fresh.saveOfflineSale(
        exampleB(MORNING + 2_000),
        deps({ repository: repository.offlineRepository, categoryNames: async () => new Map() }),
      );
      expect(outcome.ok ? outcome.order.order_no : outcome.message).toBe('T01-20260926-0003');
    }).finally(() => {
      mockReopenedDb = null;
    });
  });

  it('a ULID already saved returns the stored sale (the sequence is not used again)', async () => {
    const ulid = nextUlid();
    expect(await save(MORNING, ulid)).toBe('T01-20260926-0001');
    const again = await saveOfflineSale(exampleB(MORNING + 5_000, ulid), deps());
    expect(again).toMatchObject({ ok: true, created: false });
    expect(await save(MORNING + 6_000)).toBe('T01-20260926-0002');
  });

  it('a tablet that never registered for this server and branch cannot sell offline', async () => {
    const outcome = await saveOfflineSale(exampleB(MORNING), deps({ device: async () => null }));
    expect(outcome).toEqual({ ok: false, reason: 'notRegistered', message: 'Connect once to set up offline sales.' });
    expect(await offlineRepository.listLocalOrders()).toHaveLength(0);
  });
});

describe('crash safety (one transaction)', () => {
  it('a failure while building the sale writes nothing and does not use up the sequence', async () => {
    const ulid = nextUlid();
    await expect(
      offlineRepository.saveOfflineSale(
        { ulid, deviceCode: 'T01', businessDate: '2026-09-26', branchId: 1, cashierId: 3, shiftUlid: TEST_SHIFT_ULID, now: '2026-09-26T02:00:00Z', stockDemand: [] },
        () => {
          throw new Error('power cut');
        },
      ),
    ).rejects.toThrow('power cut');
    expect(await offlineRepository.getLocalOrder(ulid)).toBeNull();
    expect(await offlineRepository.countOutbox()).toEqual({ pending: 0, needsAttention: 0 });
    expect(await save(MORNING)).toBe('T01-20260926-0001');
  });

  it('a failing outbox insert rolls the local order back too (never one without the other)', async () => {
    const ulid = nextUlid();
    // An orphan outbox row with this ULID makes the sale's outbox insert fail (UNIQUE ulid).
    await offlineRepository.saveOfflineSale(
      { ulid, deviceCode: 'T09', businessDate: '2026-09-26', branchId: 1, cashierId: 3, shiftUlid: TEST_SHIFT_ULID, now: '2026-09-26T02:00:00Z', stockDemand: [] },
      (sequence) => {
        const input = exampleB(MORNING, ulid);
        const sale = { ...input, placedAt: '2026-09-26T02:00:00Z', businessDate: '2026-09-26', deviceCode: 'T09', sequence, cashier: cashierUser, categoryNames: new Map<number, string>() };
        return { order: buildLocalOrder(sale), payload: buildOfflineOrder(sale) };
      },
    );
    connectionOf().execSync(`DELETE FROM local_orders WHERE ulid = '${ulid}'`);

    const outcome = await saveOfflineSale(exampleB(MORNING, ulid), deps());
    expect(outcome).toMatchObject({ ok: false, reason: 'storage' });
    expect(await offlineRepository.getLocalOrder(ulid)).toBeNull();
    // The counter step was rolled back as well.
    expect(await save(MORNING + 1_000)).toBe('T01-20260926-0001');
  });

  it('lowers the cached stock of tracked products by the units sold, in the same transaction', async () => {
    await offlineRepository.replaceStockCache([{ product_id: 9, qty: 5, reorder_level: null }], '2026-09-26T01:00:00Z');
    const tea = useCartStore.getState().lines.find((line) => line.product.id === 9);
    useCartStore.setState({ lines: useCartStore.getState().lines.map((line) => (line === tea ? { ...line, product: { ...line.product, track_stock: true } } : line)) });
    expect(stockDemand(useCartStore.getState().lines)).toEqual([{ product_id: 9, qty: 3 }]);

    await save(MORNING);
    expect((await offlineRepository.readStockLevels([9])).get(9)).toBe(2);
    await save(MORNING + 1_000);
    expect((await offlineRepository.readStockLevels([9])).get(9)).toBe(-1);
  });
});

describe('the local order and the OfflineOrder (worked example B)', () => {
  function sale() {
    const input = exampleB(MORNING, '01K62Z3K5Q9V7X2M4N6P8R0T1W');
    return {
      ...input,
      placedAt: '2026-09-26T02:00:00Z',
      businessDate: '2026-09-26',
      deviceCode: 'T01',
      sequence: 5,
      cashier: { id: 3, name: 'Carla Cashier' },
      categoryNames: new Map([[1, 'Breakfast'], [2, 'Meals'], [3, 'Drinks']]),
    };
  }

  it('prints the same figures the server stores: invoice null, order_no, queue = sequence, items 1..n', () => {
    const order = buildLocalOrder(sale());
    expect(order).toMatchObject({
      invoice_no: null,
      order_no: 'T01-20260926-0005',
      queue_no: 5,
      table_no: '12',
      source: 'offline',
      placed_at: '2026-09-26T02:00:00Z',
      business_date: '2026-09-26',
      subtotal_cents: 27500,
      discount_cents: 1800,
      total_cents: 25700,
      vatable_sales_cents: 15212,
      vat_amount_cents: 1825,
      vat_exempt_sales_cents: 8663,
      tendered_cents: 30000,
      change_cents: 4300,
      authorized_by: null,
    });
    expect(order.items.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(order.items.map((item) => item.category_name)).toEqual(['Breakfast', 'Meals', 'Drinks']);
    expect(order.items.map((item) => item.order_discount_share_cents)).toEqual([270, 337, 393]);
    expect(order.payments).toEqual([
      { method: 'gcash', amount_cents: 10000, tendered_cents: null, change_cents: 0, reference_no: '1012345678901' },
      { method: 'cash', amount_cents: 15700, tendered_cents: 20000, change_cents: 4300, reference_no: null },
    ]);
    expect(orderNumberLabel(order)).toBe('T01-20260926-0005 (offline)');
    expect(ticketNumberLabel(order)).toBe('T01-5');
  });

  it('the OfflineOrder: the POST /orders body without approval, plus order_no, placed_at, cashier_id and the price snapshots', () => {
    const payload = buildOfflineOrder(sale());
    expect(payload).toEqual({
      ulid: '01K62Z3K5Q9V7X2M4N6P8R0T1W',
      customer_id: 12,
      notes: null,
      table_no: '12',
      items: [
        { product_id: 4, qty: 1, discount: { type: 'promo', kind: 'percent', value: 1000 }, notes: 'No ketchup', sc_pwd: false, unit_price_cents: 8000 },
        { product_id: 11, qty: 2, discount: null, notes: null, sc_pwd: false, unit_price_cents: 4500 },
        { product_id: 9, qty: 3, discount: null, notes: null, sc_pwd: false, unit_price_cents: 3500 },
      ],
      discount: { type: 'promo', kind: 'amount', value: 1000 },
      payments: [
        { method: 'gcash', amount_cents: 10000, reference_no: '1012345678901' },
        { method: 'cash', amount_cents: 20000, reference_no: null },
      ],
      client_total_cents: 25700,
      order_no: 'T01-20260926-0005',
      placed_at: '2026-09-26T02:00:00Z',
      cashier_id: 3,
      // Phase 6: the tablet's open shift.
      shift_ulid: TEST_SHIFT_ULID,
      sc_pwd: null,
    });
  });

  it('settles the change out of the cash; without cash there is no change', () => {
    expect(settlePayments(1000, [{ method: 'gcash', amount_cents: 1000, reference_no: 'R1' }])).toMatchObject({ change_cents: 0, tendered_cents: 1000 });
    expect(settlePayments(0, [])).toEqual({ payments: [], tendered_cents: 0, change_cents: 0 });
  });

  it('printing a local order: the receipt says "No. T01-20260926-0005 (offline)" and "QUEUE T01-5" (Q-010); the kitchen number is T01-5', () => {
    const order = buildLocalOrder(sale());
    const receipt = printedLines(
      buildReceipt(order, { settings: makeSettings(), columns: 48, timeZone: 'Asia/Manila' }),
    );
    expect(receipt.some((line) => /^No\.\s+T01-20260926-0005 \(offline\)$/.test(line.trim()))).toBe(true);
    expect(receipt.map((line) => line.trim())).toContain('QUEUE T01-5');
    expect(receipt.some((line) => line.includes('QUEUE #'))).toBe(false);
    expect(receipt.some((line) => line.includes('INV-'))).toBe(false);

    const ticket = printedLines(
      buildKitchenTicket(order, { printerName: 'Kitchen', items: order.items, columns: 48, timeZone: 'Asia/Manila' }),
    );
    expect(ticket.map((line) => line.trim())).toContain('T01-5');
    expect(ticket.some((line) => line.trim() === '#5')).toBe(false);
    expect(ticket.some((line) => line.includes('T01-20260926-0005'))).toBe(true);
  });
});
