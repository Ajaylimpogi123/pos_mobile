/**
 * SQLite storage for offline sales (docs/api-contract.md → Offline Sales →
 * Device rules): `local_orders`, the `outbox`, the daily `order_counters`
 * and the advisory `stock_cache`.
 *
 * **An offline sale is one transaction** (`saveOfflineSale`): the next daily
 * sequence, the local order, its outbox row and the stock-cache decrements
 * commit together or not at all. The sale is complete when it commits.
 * Drizzle's expo-sqlite driver is synchronous, so a transaction runs start to
 * finish on the JS thread with nothing interleaved. The functions still
 * return promises so callers (and tests) treat the store as an async boundary.
 *
 * Shifts & Reporting (Phase 6):
 * - Every completed sale is stored: online ones as `synced` with the server
 *   `Order` (`saveSyncedSale`), each with its `shift_ulid`.
 * - The outbox carries an `entity`: `order`, or a shift event (`shift_open`,
 *   `cash_movement`, `shift_close`, written by `@/db/shiftRepository`). It
 *   stays **strictly FIFO across entities** (`nextBatch`).
 * - Only the current shift and the last 7 days are kept: older `synced`
 *   sales are pruned (`pruneSyncedSales`). Unsynced ones never are.
 *
 * Outbox rows are deleted only once the server has them (`accepted` /
 * `duplicate` for a sale, a 2xx for a shift event).
 */
import { and, asc, count, desc, eq, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';

import { getDb } from '@/db/client';
import {
  localOrders,
  orderCounters,
  outbox,
  recipeStatusCache,
  stockCache,
  type LocalOrderRow,
  type OutboxEntity,
  type OutboxRow,
} from '@/db/schema';
import type {
  CashMovementRequest,
  OfflineOrder,
  Order,
  PrintableOrder,
  ShiftCloseRequest,
  RecipeStatus,
  ShiftOpenRequest,
  StockLevel,
} from '@/services/types';
import { withReversalDefaults } from '@pos/core/sale/refunds';
import { chunk } from '@/utils/collections';

/** Units of one tracked product (an offline sale lowers the cached stock by these). */
export type StockDemand = { product_id: number; qty: number };

export type LocalOrderStatus = LocalOrderRow['status'];

/** A `local_orders` row with its JSON parsed. */
export type LocalOrderRecord = {
  ulid: string;
  /** The device number of an offline sale; `null` for an online one (Phase 6). */
  orderNo: string | null;
  /** The printable local order (an online sale: the server `Order`). */
  order: PrintableOrder;
  status: LocalOrderStatus;
  /** The server's `Order`, once synced. */
  serverOrder: Order | null;
  lastError: string | null;
  businessDate: string;
  branchId: number;
  cashierId: number;
  /** Phase 6: the shift it was rung into (`null` before Phase 6). */
  shiftUlid: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OfflineSaleDraft = {
  ulid: string;
  deviceCode: string;
  /** `YYYY-MM-DD`: the key of the daily sequence. */
  businessDate: string;
  branchId: number;
  cashierId: number;
  /** Phase 6: the tablet's open shift. */
  shiftUlid: string;
  /** ISO 8601 UTC: `created_at` and the outbox row's first `next_attempt_at`. */
  now: string;
  /** Units sold per tracked product: the advisory stock cache goes down by these. */
  stockDemand: readonly StockDemand[];
};

/** What an offline sale stores, built once its daily sequence is known. */
export type OfflineSaleDocuments = { order: PrintableOrder; payload: OfflineOrder };

export type SaveOfflineSaleResult = {
  record: LocalOrderRecord;
  /** `false`: a sale with this ULID was already saved (nothing new was written). */
  created: boolean;
};

export type OutboxCounts = { pending: number; needsAttention: number };

/** A shift event's outbox payload: its key, the shift, and the request body. */
export type ShiftEventPayload<Body> = {
  /** The outbox row's key (see `outbox.ulid`). */
  ulid: string;
  shift_ulid: string;
  body: Body;
};

export type ShiftEventEntity = Exclude<OutboxEntity, 'order'>;

type EntryBase = { id: number; ulid: string; attempts: number; nextAttemptAt: string };

/** A sale waiting for `POST /sync/orders`. */
export type OrderOutboxEntry = EntryBase & { entity: 'order'; payload: OfflineOrder };

/** A shift event waiting for its endpoint (Phase 6). */
export type ShiftEventEntry =
  | (EntryBase & { entity: 'shift_open'; payload: ShiftEventPayload<ShiftOpenRequest> })
  | (EntryBase & { entity: 'cash_movement'; payload: ShiftEventPayload<CashMovementRequest> })
  | (EntryBase & { entity: 'shift_close'; payload: ShiftEventPayload<ShiftCloseRequest> });

/** An outbox row with its payload parsed. */
export type OutboxEntry = OrderOutboxEntry | ShiftEventEntry;

/** A shift event as the Sync queue shows it. */
export type ShiftEventRecord = {
  ulid: string;
  entity: ShiftEventEntity;
  shiftUlid: string;
  body: ShiftOpenRequest | CashMovementRequest | ShiftCloseRequest;
  status: OutboxRow['status'];
  lastError: string | null;
  createdAt: string;
};

export type LocalOrderFilter = {
  statuses?: readonly LocalOrderStatus[];
  businessDate?: string;
  branchId?: number;
  cashierId?: number;
  /** Phase 6: the sales of one shift. */
  shiftUlid?: string;
};

export function isOrderEntry(entry: OutboxEntry): entry is OrderOutboxEntry {
  return entry.entity === 'order';
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function toRecord(row: LocalOrderRow): LocalOrderRecord | null {
  const order = parseJson<PrintableOrder>(row.order_json);
  if (!order) return null;
  const serverOrder = parseJson<Order>(row.server_order);
  // Voids & Refunds (Phase 7): JSON stored before Phase 7 lacks the reversal fields.
  return {
    ulid: row.ulid,
    orderNo: row.order_no,
    order: withReversalDefaults(order),
    status: row.status,
    serverOrder: serverOrder ? withReversalDefaults(serverOrder) : null,
    lastError: row.last_error,
    businessDate: row.business_date,
    branchId: row.branch_id,
    cashierId: row.cashier_id,
    shiftUlid: row.shift_ulid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isShiftEventPayload(value: unknown): value is ShiftEventPayload<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Partial<ShiftEventPayload<unknown>>;
  return typeof payload.ulid === 'string' && typeof payload.shift_ulid === 'string' && typeof payload.body === 'object';
}

function toEntry(row: OutboxRow): OutboxEntry | null {
  const base: EntryBase = { id: row.id, ulid: row.ulid, attempts: row.attempts, nextAttemptAt: row.next_attempt_at };
  if (row.entity === 'order') {
    const payload = parseJson<OfflineOrder>(row.payload);
    return payload ? { ...base, entity: 'order', payload } : null;
  }
  const payload = parseJson<unknown>(row.payload);
  if (!isShiftEventPayload(payload)) return null;
  switch (row.entity) {
    case 'shift_open':
      return { ...base, entity: 'shift_open', payload: payload as ShiftEventPayload<ShiftOpenRequest> };
    case 'cash_movement':
      return { ...base, entity: 'cash_movement', payload: payload as ShiftEventPayload<CashMovementRequest> };
    case 'shift_close':
      return { ...base, entity: 'shift_close', payload: payload as ShiftEventPayload<ShiftCloseRequest> };
    default:
      return null;
  }
}

/**
 * Saves an offline sale in **one** transaction: takes the next daily
 * sequence for `(device code, business date)`, builds the documents with it,
 * inserts the local order and its outbox row, and lowers the cached stock.
 * If anything throws, nothing is written (the sequence isn't used up either).
 * A ULID that is already stored returns the stored sale unchanged.
 */
async function saveOfflineSale(
  draft: OfflineSaleDraft,
  build: (sequence: number) => OfflineSaleDocuments,
): Promise<SaveOfflineSaleResult> {
  let result: SaveOfflineSaleResult | null = null;

  getDb().transaction((tx) => {
    const existing = tx.select().from(localOrders).where(eq(localOrders.ulid, draft.ulid)).get();
    const existingRecord = existing ? toRecord(existing) : null;
    if (existingRecord) {
      result = { record: existingRecord, created: false };
      return;
    }

    const counter = tx
      .select({ last: orderCounters.last_seq })
      .from(orderCounters)
      .where(and(eq(orderCounters.device_code, draft.deviceCode), eq(orderCounters.business_date, draft.businessDate)))
      .get();
    const sequence = (counter?.last ?? 0) + 1;
    tx.insert(orderCounters)
      .values({ device_code: draft.deviceCode, business_date: draft.businessDate, last_seq: sequence })
      .onConflictDoUpdate({ target: [orderCounters.device_code, orderCounters.business_date], set: { last_seq: sequence } })
      .run();

    const documents = build(sequence);
    const row: LocalOrderRow = {
      ulid: draft.ulid,
      order_no: documents.payload.order_no,
      order_json: JSON.stringify(documents.order),
      status: 'pending',
      server_order: null,
      last_error: null,
      business_date: draft.businessDate,
      branch_id: draft.branchId,
      cashier_id: draft.cashierId,
      shift_ulid: draft.shiftUlid,
      created_at: draft.now,
      updated_at: draft.now,
    };
    tx.insert(localOrders).values(row).run();
    tx.insert(outbox)
      .values({
        ulid: draft.ulid,
        entity: 'order',
        payload: JSON.stringify(documents.payload),
        attempts: 0,
        next_attempt_at: draft.now,
        status: 'pending',
        last_error: null,
        created_at: draft.now,
      })
      .run();

    for (const demand of draft.stockDemand) {
      if (demand.qty <= 0) continue;
      tx.update(stockCache)
        .set({ qty: sql`${stockCache.qty} - ${demand.qty}` })
        .where(eq(stockCache.product_id, demand.product_id))
        .run();
    }

    const record = toRecord(row);
    if (!record) throw new Error('The offline sale could not be stored.');
    result = { record, created: true };
  });

  if (!result) throw new Error('The offline sale could not be stored.');
  return result;
}

export type SyncedSaleDraft = {
  /** The user's branch (the Orders filters). */
  branchId: number;
  /** The shift it was sent with (the server `Order` carries it too). */
  shiftUlid: string | null;
  /** ISO 8601 UTC. */
  now: string;
};

/**
 * Phase 6: stores an **online** sale (a `201`, or the Q-004 lookup) as
 * `synced`, with the server `Order` as both documents, so the tablet can
 * compute its shift report. A ULID already stored (e.g. saved offline after a
 * timeout) is left as it is. Returns `true` when a row was written.
 */
async function saveSyncedSale(order: Order, draft: SyncedSaleDraft): Promise<boolean> {
  const json = JSON.stringify(order);
  const rows = getDb()
    .insert(localOrders)
    .values({
      ulid: order.ulid,
      order_no: order.order_no,
      order_json: json,
      status: 'synced',
      server_order: json,
      last_error: null,
      business_date: order.business_date,
      branch_id: draft.branchId,
      cashier_id: order.cashier.id,
      shift_ulid: order.shift_ulid ?? draft.shiftUlid,
      created_at: draft.now,
      updated_at: draft.now,
    })
    .onConflictDoNothing()
    .returning({ ulid: localOrders.ulid })
    .all();
  return rows.length > 0;
}

/**
 * Voids & Refunds (Phase 7): replaces the stored server `Order` of a synced
 * sale after a void (`200`) or a refund (`201`), so the tablet's shift report
 * follows it (a voided sale counts as a void, not a sale). An online sale's
 * printable copy is the server `Order` too (it has no `order_no`), so it is
 * replaced as well; an offline sale keeps its local printable order. Only
 * when the tablet has the sale and it has synced. Returns `true` when a row changed.
 */
async function replaceServerOrder(order: Order, now: string): Promise<boolean> {
  const json = JSON.stringify(order);
  let changed = false;
  getDb().transaction((tx) => {
    const row = tx
      .select({ orderNo: localOrders.order_no })
      .from(localOrders)
      .where(and(eq(localOrders.ulid, order.ulid), eq(localOrders.status, 'synced')))
      .get();
    if (!row) return;
    tx.update(localOrders)
      .set(row.orderNo === null ? { server_order: json, order_json: json, updated_at: now } : { server_order: json, updated_at: now })
      .where(eq(localOrders.ulid, order.ulid))
      .run();
    changed = true;
  });
  return changed;
}

async function getLocalOrder(ulid: string): Promise<LocalOrderRecord | null> {
  const row = getDb().select().from(localOrders).where(eq(localOrders.ulid, ulid)).get();
  return row ? toRecord(row) : null;
}

/** Local orders, newest first. */
async function listLocalOrders(filter: LocalOrderFilter = {}): Promise<LocalOrderRecord[]> {
  const conditions: SQL[] = [];
  if (filter.statuses) conditions.push(inArray(localOrders.status, [...filter.statuses]));
  if (filter.businessDate !== undefined) conditions.push(eq(localOrders.business_date, filter.businessDate));
  if (filter.branchId !== undefined) conditions.push(eq(localOrders.branch_id, filter.branchId));
  if (filter.cashierId !== undefined) conditions.push(eq(localOrders.cashier_id, filter.cashierId));
  if (filter.shiftUlid !== undefined) conditions.push(eq(localOrders.shift_ulid, filter.shiftUlid));
  const rows = getDb()
    .select()
    .from(localOrders)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(localOrders.created_at), desc(localOrders.ulid))
    .all();
  return rows.map(toRecord).filter((record): record is LocalOrderRecord => record !== null);
}

async function countOutbox(): Promise<OutboxCounts> {
  const rows = getDb().select({ status: outbox.status, total: count() }).from(outbox).groupBy(outbox.status).all();
  const counts: OutboxCounts = { pending: 0, needsAttention: 0 };
  for (const row of rows) {
    if (row.status === 'pending') counts.pending = row.total;
    else counts.needsAttention = row.total;
  }
  return counts;
}

/**
 * The next piece of work, oldest first. **Strict FIFO across entities:**
 * - when the oldest pending row is a sale, the consecutive sales after it (up
 *   to `limit`), stopping at the first shift event;
 * - when it is a shift event, that event alone.
 * While the oldest pending row is still backing off (and it isn't `force`d),
 * nothing is returned, so a newer row never overtakes an older one.
 */
async function nextBatch(limit: number, now: string, force: boolean): Promise<OutboxEntry[]> {
  const rows = getDb()
    .select()
    .from(outbox)
    .where(eq(outbox.status, 'pending'))
    .orderBy(asc(outbox.id))
    .limit(limit)
    .all();
  if (rows.length === 0) return [];
  if (!force && rows[0].next_attempt_at > now) return [];

  if (rows[0].entity !== 'order') {
    const entry = toEntry(rows[0]);
    return entry ? [entry] : [];
  }
  const run: OutboxRow[] = [];
  for (const row of rows) {
    if (row.entity !== 'order') break;
    run.push(row);
  }
  return run.map(toEntry).filter((entry): entry is OutboxEntry => entry !== null);
}

/** Phase 8 heartbeat: `created_at` of the oldest pending outbox row (`null`: nothing pending). */
async function oldestPendingAt(): Promise<string | null> {
  const row = getDb()
    .select({ at: outbox.created_at })
    .from(outbox)
    .where(eq(outbox.status, 'pending'))
    .orderBy(asc(outbox.id))
    .limit(1)
    .get();
  return row?.at ?? null;
}

/** When the oldest pending row is due (`null`: nothing pending). */
async function nextAttemptAt(): Promise<string | null> {
  const row = getDb()
    .select({ at: outbox.next_attempt_at })
    .from(outbox)
    .where(eq(outbox.status, 'pending'))
    .orderBy(asc(outbox.id))
    .limit(1)
    .get();
  return row?.at ?? null;
}

/** `accepted` / `duplicate`: the local order is `synced` with the server's `Order`, and its outbox row goes. */
async function markSynced(ulid: string, serverOrder: Order, now: string): Promise<void> {
  getDb().transaction((tx) => {
    tx.update(localOrders)
      .set({ status: 'synced', server_order: JSON.stringify(serverOrder), last_error: null, updated_at: now })
      .where(eq(localOrders.ulid, ulid))
      .run();
    tx.delete(outbox).where(eq(outbox.ulid, ulid)).run();
  });
}

/** Phase 6: a shift event the server accepted: its outbox row goes (the local shift is already up to date). */
async function completeShiftEvent(ulid: string): Promise<void> {
  getDb()
    .delete(outbox)
    .where(and(eq(outbox.ulid, ulid), ne(outbox.entity, 'order')))
    .run();
}

/**
 * `rejected`: the row needs attention, with the server's message. Nothing is
 * deleted. For a sale, its local order is marked too (a shift event has none).
 */
async function markRejected(ulid: string, message: string, now: string): Promise<void> {
  getDb().transaction((tx) => {
    tx.update(localOrders)
      .set({ status: 'needs_attention', last_error: message, updated_at: now })
      .where(eq(localOrders.ulid, ulid))
      .run();
    tx.update(outbox).set({ status: 'needs_attention', last_error: message }).where(eq(outbox.ulid, ulid)).run();
  });
}

/** A network or 5xx failure: one more attempt on each row, and the next try waits until `nextAttempt`. */
async function deferRows(ulids: readonly string[], nextAttempt: string, error: string): Promise<void> {
  if (ulids.length === 0) return;
  getDb().transaction((tx) => {
    for (const part of chunk([...ulids], 500)) {
      tx.update(outbox)
        .set({ attempts: sql`${outbox.attempts} + 1`, next_attempt_at: nextAttempt, last_error: error })
        .where(inArray(outbox.ulid, part))
        .run();
    }
  });
}

/** Retry of a row that needs attention (a sale or a shift event): back in the queue (at its FIFO place), and pending again. */
async function requeue(ulid: string, now: string): Promise<boolean> {
  let requeued = false;
  getDb().transaction((tx) => {
    const rows = tx
      .update(outbox)
      .set({ status: 'pending', attempts: 0, next_attempt_at: now, last_error: null })
      .where(and(eq(outbox.ulid, ulid), eq(outbox.status, 'needs_attention')))
      .returning({ id: outbox.id })
      .all();
    if (rows.length === 0) return;
    tx.update(localOrders)
      .set({ status: 'pending', last_error: null, updated_at: now })
      .where(eq(localOrders.ulid, ulid))
      .run();
    requeued = true;
  });
  return requeued;
}

/** Phase 6: the shift events still in the outbox (the Sync queue), newest first. */
async function listShiftEvents(statuses: readonly OutboxRow['status'][] = ['pending', 'needs_attention']): Promise<ShiftEventRecord[]> {
  const rows = getDb()
    .select()
    .from(outbox)
    .where(and(ne(outbox.entity, 'order'), inArray(outbox.status, [...statuses])))
    .orderBy(desc(outbox.id))
    .all();
  const records: ShiftEventRecord[] = [];
  for (const row of rows) {
    const entry = toEntry(row);
    if (!entry || isOrderEntry(entry)) continue;
    records.push({
      ulid: row.ulid,
      entity: entry.entity,
      shiftUlid: entry.payload.shift_ulid,
      body: entry.payload.body,
      status: row.status,
      lastError: row.last_error,
      createdAt: row.created_at,
    });
  }
  return records;
}

/**
 * Phase 6: deletes `synced` sales stored before `cutoff` (ISO 8601 UTC),
 * except those of `keepShiftUlid` (the current shift). Unsynced sales are
 * never deleted. Returns how many were deleted.
 */
async function pruneSyncedSales(cutoff: string, keepShiftUlid: string | null): Promise<number> {
  const conditions: SQL[] = [eq(localOrders.status, 'synced'), lt(localOrders.created_at, cutoff)];
  if (keepShiftUlid !== null) {
    const outsideShift = or(isNull(localOrders.shift_ulid), ne(localOrders.shift_ulid, keepShiftUlid));
    if (outsideShift) conditions.push(outsideShift);
  }
  const rows = getDb()
    .delete(localOrders)
    .where(and(...conditions))
    .returning({ ulid: localOrders.ulid })
    .all();
  return rows.length;
}

/** The cached levels of these products (a product without a cached level is missing from the map). */
async function readStockLevels(productIds: readonly number[]): Promise<Map<number, number>> {
  const levels = new Map<number, number>();
  if (productIds.length === 0) return levels;
  for (const ids of chunk([...new Set(productIds)], 500)) {
    const rows = getDb()
      .select({ id: stockCache.product_id, qty: stockCache.qty })
      .from(stockCache)
      .where(inArray(stockCache.product_id, ids))
      .all();
    for (const row of rows) levels.set(row.id, row.qty);
  }
  return levels;
}

/** A cached level for the Sell tile badges (Inventory, v1 completion). */
export type CachedStockBadge = { qty: number; reorderLevel: number | null };

/** The cached level and reorder level of these products (a product without a cached level is missing from the map). */
async function readStockBadges(productIds: readonly number[]): Promise<Map<number, CachedStockBadge>> {
  const badges = new Map<number, CachedStockBadge>();
  if (productIds.length === 0) return badges;
  for (const ids of chunk([...new Set(productIds)], 500)) {
    const rows = getDb()
      .select({ id: stockCache.product_id, qty: stockCache.qty, reorderLevel: stockCache.reorder_level })
      .from(stockCache)
      .where(inArray(stockCache.product_id, ids))
      .all();
    for (const row of rows) badges.set(row.id, { qty: row.qty, reorderLevel: row.reorderLevel ?? null });
  }
  return badges;
}

/** §J: the recipe products among these whose cached status is `check` (any component out). */
async function readRecipeChecks(productIds: readonly number[]): Promise<Set<number>> {
  const checks = new Set<number>();
  if (productIds.length === 0) return checks;
  for (const ids of chunk([...new Set(productIds)], 500)) {
    const rows = getDb()
      .select({ id: recipeStatusCache.product_id })
      .from(recipeStatusCache)
      .where(and(inArray(recipeStatusCache.product_id, ids), eq(recipeStatusCache.status, 'check')))
      .all();
    for (const row of rows) checks.add(row.id);
  }
  return checks;
}

/**
 * Replaces the whole stock cache with a `GET /sync/stock` snapshot, in one
 * transaction: the levels, and (§J) the recipe statuses (`[]` when the
 * server sends none).
 */
async function replaceStockCache(levels: readonly StockLevel[], serverTime: string, recipes: readonly RecipeStatus[] = []): Promise<void> {
  getDb().transaction((tx) => {
    tx.delete(recipeStatusCache).run();
    for (const part of chunk([...recipes], 100)) {
      tx.insert(recipeStatusCache)
        .values(part.map((recipe) => ({ product_id: recipe.product_id, status: recipe.status, server_time: serverTime })))
        .onConflictDoUpdate({
          target: recipeStatusCache.product_id,
          set: { status: sql.raw('excluded.`status`'), server_time: serverTime },
        })
        .run();
    }
    tx.delete(stockCache).run();
    for (const part of chunk([...levels], 100)) {
      tx.insert(stockCache)
        .values(
          part.map((level) => ({
            product_id: level.product_id,
            qty: level.qty,
            reorder_level: level.reorder_level ?? null,
            server_time: serverTime,
          })),
        )
        .onConflictDoUpdate({
          target: stockCache.product_id,
          set: { qty: sql.raw('excluded.`qty`'), reorder_level: sql.raw('excluded.`reorder_level`'), server_time: serverTime },
        })
        .run();
    }
  });
}

export type OfflineRepository = {
  saveOfflineSale: typeof saveOfflineSale;
  saveSyncedSale: typeof saveSyncedSale;
  replaceServerOrder: typeof replaceServerOrder;
  getLocalOrder: typeof getLocalOrder;
  listLocalOrders: typeof listLocalOrders;
  countOutbox: typeof countOutbox;
  oldestPendingAt: typeof oldestPendingAt;
  nextBatch: typeof nextBatch;
  nextAttemptAt: typeof nextAttemptAt;
  markSynced: typeof markSynced;
  completeShiftEvent: typeof completeShiftEvent;
  markRejected: typeof markRejected;
  deferRows: typeof deferRows;
  requeue: typeof requeue;
  listShiftEvents: typeof listShiftEvents;
  pruneSyncedSales: typeof pruneSyncedSales;
  readStockLevels: typeof readStockLevels;
  readStockBadges: typeof readStockBadges;
  readRecipeChecks: typeof readRecipeChecks;
  replaceStockCache: typeof replaceStockCache;
};

/** The SQLite-backed repository used by the app. */
export const offlineRepository: OfflineRepository = {
  saveOfflineSale,
  saveSyncedSale,
  replaceServerOrder,
  getLocalOrder,
  listLocalOrders,
  countOutbox,
  oldestPendingAt,
  nextBatch,
  nextAttemptAt,
  markSynced,
  completeShiftEvent,
  markRejected,
  deferRows,
  requeue,
  listShiftEvents,
  pruneSyncedSales,
  readStockLevels,
  readStockBadges,
  readRecipeChecks,
  replaceStockCache,
};
