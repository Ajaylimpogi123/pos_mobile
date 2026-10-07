/**
 * On-device SQLite schema (Drizzle). The tablet's own copy of the menu, pulled
 * from `GET /api/v1/sync/catalogue` (docs/api-contract.md → Catalogue Sync
 * (Phase 2)). Column names mirror the contract's `SyncCategory` /
 * `SyncProduct` fields exactly, so a synced row is stored as it arrives.
 *
 * - Ids are the **server** ids (no local autoincrement).
 * - `products.category_id` has no foreign key on purpose: categories and
 *   products page independently, so a product may land before its category.
 *   The visibility rules hide a product until its category exists locally.
 * - There is no `cost_cents` column: the endpoint never sends it.
 *
 * After changing this file, run `npx drizzle-kit generate --name <change>`.
 * A migration that needs a fresh baseline clears the stored cursor in its
 * SQL (`UPDATE sync_state SET cursor = NULL;`): no cursor means the next sync
 * is a full baseline (contract → "When to start a baseline").
 */
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sort_order: integer('sort_order').notNull(),
  is_active: integer('is_active', { mode: 'boolean' }).notNull(),
  image_url: text('image_url'),
  image_path: text('image_path'),
  /** ISO 8601 UTC. */
  updated_at: text('updated_at').notNull(),
});

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey(),
    category_id: integer('category_id').notNull(),
    sku: text('sku'),
    name: text('name').notNull(),
    description: text('description'),
    /** Integer centavos, VAT-inclusive. */
    price_cents: integer('price_cents').notNull(),
    is_vatable: integer('is_vatable', { mode: 'boolean' }).notNull(),
    is_available: integer('is_available', { mode: 'boolean' }).notNull(),
    track_stock: integer('track_stock', { mode: 'boolean' }).notNull(),
    sort_order: integer('sort_order').notNull(),
    image_url: text('image_url'),
    image_path: text('image_path'),
    /** ISO 8601 UTC. */
    updated_at: text('updated_at').notNull(),
  },
  (table) => [index('products_category_id_index').on(table.category_id)],
);

/**
 * Sync bookkeeping, one row per synced scope (`catalogue` today; the Phase 5
 * general sync adds its own). Saved in the same transaction as the data it
 * describes.
 */
export const syncState = sqliteTable('sync_state', {
  scope: text('scope').primaryKey(),
  /** `meta.next_cursor` of the last applied page. `null` → the next sync is a baseline. */
  cursor: text('cursor'),
  /** `EXPO_PUBLIC_API_URL` the cursor belongs to. A different origin → baseline. */
  api_origin: text('api_origin'),
  /** `meta.server_time` of the last completed run (ISO 8601 UTC): "Synced N min ago". */
  server_time: text('server_time'),
});

/**
 * Printing (Phase 4): the cached `GET /api/v1/print-config` `data`, one row per
 * API origin and branch, so the device prints while the server is out of reach.
 * Logout keeps it.
 */
export const printConfig = sqliteTable(
  'print_config',
  {
    /** `EXPO_PUBLIC_API_URL` the config came from. */
    api_origin: text('api_origin').notNull(),
    branch_id: integer('branch_id').notNull(),
    /** The whole `data` object, as JSON. */
    payload: text('payload').notNull(),
    /** `data.generated_at` (ISO 8601 UTC). */
    generated_at: text('generated_at').notNull(),
    /** When this device stored it (ISO 8601 UTC). */
    fetched_at: text('fetched_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.api_origin, table.branch_id] })],
);

/**
 * Printing (Phase 4): the persistent print queue. One row per document sent
 * to one printer. The document is **rebuilt at send time** from `order_json`
 * and the current config (host, port, width, receipt lines), so fixing a
 * printer's address and pressing Retry works.
 *
 * - A first print is unique per `(order_ulid, kind, printer_id, copy_no)`
 *   (a partial index over `is_reprint = 0`), so a replayed `201` or the Q-004
 *   lookup never prints twice. Reprints are never deduplicated.
 * - Test prints are never stored here.
 */
export const printJobs = sqliteTable(
  'print_jobs',
  {
    /** A ULID made on the device. */
    id: text('id').primaryKey(),
    order_ulid: text('order_ulid').notNull(),
    /** For labels ("Kitchen ticket #17"). */
    queue_no: integer('queue_no').notNull(),
    /**
     * Shifts & Reporting (Phase 6) adds the shift reports `x_read` and `z_read`
     * (receipt printer). For those, `order_ulid` holds the shift's ULID,
     * `queue_no` is 0 and `order_json` holds the `ShiftReadDocument`.
     *
     * Voids & Refunds (Phase 7) adds `void_slip` (receipt printer),
     * `kitchen_void` (one per station, `item_ids` as for a ticket) and
     * `refund_slip` (receipt printer). A void slip and a VOID ticket keep the
     * order's ULID and its `Order` JSON; a refund slip keeps the **refund's**
     * ULID in `order_ulid` and a `RefundSlipDocument` (`{ order, refund }`), so
     * each refund's first print is deduplicated on its own.
     */
    kind: text('kind', {
      enum: ['receipt', 'kitchen', 'x_read', 'z_read', 'void_slip', 'kitchen_void', 'refund_slip'],
    }).notNull(),
    printer_id: integer('printer_id').notNull(),
    /** Snapshots for labels, in case the printer is renamed or deleted later. */
    printer_name: text('printer_name').notNull(),
    printer_role: text('printer_role', { enum: ['cashier', 'kitchen', 'bar'] }).notNull(),
    /** 1-based; always 1 for a ticket. */
    copy_no: integer('copy_no').notNull(),
    /** How many receipt copies this print made ("Copy 2 of 2"). */
    copies: integer('copies').notNull(),
    is_reprint: integer('is_reprint', { mode: 'boolean' }).notNull(),
    /** The server's `Order`, as JSON: documents print its fields and never compute money. */
    order_json: text('order_json').notNull(),
    /** Kitchen tickets: the `items[].id`s for this station, as a JSON array. `null` for receipts. */
    item_ids: text('item_ids'),
    status: text('status', { enum: ['pending', 'printing', 'sent', 'failed'] }).notNull(),
    attempts: integer('attempts').notNull(),
    /** Why it failed (shown to staff). */
    error: text('error'),
    /** A failure the cashier dismissed from the Sell banner. */
    dismissed: integer('dismissed', { mode: 'boolean' }).notNull(),
    /** ISO 8601 UTC. */
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('print_jobs_first_print_unique')
      .on(table.order_ulid, table.kind, table.printer_id, table.copy_no)
      // An X-read is a snapshot printed on demand, as often as asked: it is never deduplicated.
      .where(sql`is_reprint = 0 AND kind <> 'x_read'`),
    index('print_jobs_status_index').on(table.status),
    index('print_jobs_order_ulid_index').on(table.order_ulid),
  ],
);

/**
 * Offline Sales (Phase 5): the sales saved on this tablet
 * (docs/api-contract.md → Offline Sales → Device rules → Local write). One row
 * per offline sale, written in the same transaction as its `outbox` row and
 * its `order_counters` step. A synced sale keeps the server's `Order` for reprints.
 *
 * Shifts & Reporting (Phase 6): **every** completed sale is stored, the online
 * ones as `synced` with the server `Order`, so the tablet computes its own
 * shift report. Only the current shift and the last 7 days are kept: older
 * `synced` rows are pruned (`pending` and `needs_attention` never are).
 */
export const localOrders = sqliteTable(
  'local_orders',
  {
    /** The sale's ULID: the same one `POST /orders` was sent with, if it was. */
    ulid: text('ulid').primaryKey(),
    /** `{device code}-{YYYYMMDD}-{seq}`, e.g. `T01-20260926-0005`; `null` for an online sale (Phase 6). */
    order_no: text('order_no'),
    /** The printable local order (`PrintableOrder`), as JSON. */
    order_json: text('order_json').notNull(),
    status: text('status', { enum: ['pending', 'synced', 'needs_attention'] }).notNull(),
    /** The server's `Order`, as JSON, once synced (`accepted` or `duplicate`). */
    server_order: text('server_order'),
    /** The server's message for a `rejected` sale. */
    last_error: text('last_error'),
    /** Device-side filters for the Orders list (copied from the order). */
    business_date: text('business_date').notNull(),
    branch_id: integer('branch_id').notNull(),
    cashier_id: integer('cashier_id').notNull(),
    /** Phase 6: the shift the sale was rung into (`null` for sales stored before Phase 6). */
    shift_ulid: text('shift_ulid'),
    /** ISO 8601 UTC. */
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('local_orders_status_index').on(table.status),
    index('local_orders_business_date_index').on(table.business_date),
    index('local_orders_shift_ulid_index').on(table.shift_ulid),
  ],
);

/**
 * Offline Sales (Phase 5): what still has to reach the server
 * (PROJECT_MEMORY §8.3). Drained **strictly FIFO** (by `id`) by
 * `@/sync/outboxSync`: consecutive `order` rows go in batches of up to 50;
 * each shift event (Phase 6) goes on its own, to its endpoint. A row is
 * deleted once the server has it; a `rejected` one stays as
 * `needs_attention` until Retry puts it back to `pending`.
 */
export const outbox = sqliteTable(
  'outbox',
  {
    /** FIFO order. */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /**
     * The row's key: the sale's ULID, the shift's (`shift_open`), the cash
     * movement's (`cash_movement`), or a ULID made for the close (`shift_close`).
     */
    ulid: text('ulid').notNull(),
    /** Phase 6: what the row sends. Rows from before Phase 6 are sales. */
    entity: text('entity', { enum: ['order', 'shift_open', 'cash_movement', 'shift_close'] })
      .notNull()
      .default('order'),
    /** `order`: the `OfflineOrder`. A shift event: `{ ulid, shift_ulid, body }` (`ShiftEventPayload`). As JSON. */
    payload: text('payload').notNull(),
    attempts: integer('attempts').notNull(),
    /** ISO 8601 UTC: the backoff after a network or 5xx failure. */
    next_attempt_at: text('next_attempt_at').notNull(),
    status: text('status', { enum: ['pending', 'needs_attention'] }).notNull(),
    last_error: text('last_error'),
    created_at: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('outbox_ulid_unique').on(table.ulid), index('outbox_status_index').on(table.status)],
);

/** Offline Sales (Phase 5): the next daily sequence of `order_no`, per device code and business date. */
export const orderCounters = sqliteTable(
  'order_counters',
  {
    device_code: text('device_code').notNull(),
    /** `YYYY-MM-DD` (branch timezone and day start). */
    business_date: text('business_date').notNull(),
    /** The last sequence used (0 before the first sale of the day). */
    last_seq: integer('last_seq').notNull(),
  },
  (table) => [primaryKey({ columns: [table.device_code, table.business_date] })],
);

/**
 * Offline Sales (Phase 5): the advisory stock levels from `GET /sync/stock`
 * (every `track_stock` product of the branch), decremented by offline sales.
 * Only for "offline estimate" warnings: stock never blocks an offline sale.
 */
export const stockCache = sqliteTable('stock_cache', {
  product_id: integer('product_id').primaryKey(),
  /** Can be negative. */
  qty: integer('qty').notNull(),
  /**
   * Inventory (v1 completion): the product's reorder level (`null`: no
   * low-stock alert). The Sell tiles show `Low · n left` at or below it.
   */
  reorder_level: integer('reorder_level'),
  /** `data.server_time` of the snapshot (ISO 8601 UTC). */
  server_time: text('server_time').notNull(),
});

/**
 * Ingredients, Recipes & Purchasing §J: `GET /sync/stock` → `recipes[]`, one
 * row per `recipe` product, replaced with the stock cache in one transaction.
 * `check` (any component is out) shows the `Check stock` chip on its Sell
 * tile. Advisory only: it never blocks a sale.
 */
export const recipeStatusCache = sqliteTable('recipe_status_cache', {
  product_id: integer('product_id').primaryKey(),
  status: text('status', { enum: ['ok', 'check'] }).notNull(),
  /** `data.server_time` of the snapshot (ISO 8601 UTC). */
  server_time: text('server_time').notNull(),
});

/**
 * Shifts & Reporting (Phase 6): this tablet's cash shifts
 * (docs/api-contract.md → Shifts & Reporting → Device rules). One open shift
 * per tablet (and branch) at a time. Opening and closing write here and to
 * the `outbox` in one transaction, so they work offline. The user names are
 * snapshots for the printed X-read and Z-read.
 */
export const shifts = sqliteTable(
  'shifts',
  {
    /** Made on the tablet; also the key of the `shift_open` outbox row. */
    ulid: text('ulid').primaryKey(),
    branch_id: integer('branch_id').notNull(),
    status: text('status', { enum: ['open', 'closed'] }).notNull(),
    /** ISO 8601 UTC. */
    opened_at: text('opened_at').notNull(),
    opened_by_id: integer('opened_by_id').notNull(),
    opened_by_name: text('opened_by_name').notNull(),
    opening_float_cents: integer('opening_float_cents').notNull(),
    /** `null` while open. */
    closed_at: text('closed_at'),
    /** `null` while open, and when the server said the shift was already closed. */
    closed_by_id: integer('closed_by_id'),
    closed_by_name: text('closed_by_name'),
    counted_cash_cents: integer('counted_cash_cents'),
    close_note: text('close_note'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [index('shifts_branch_status_index').on(table.branch_id, table.status)],
);

/** Shifts & Reporting (Phase 6): cash put into (`in`) or taken out of (`out`) the drawer during a shift. */
export const cashMovements = sqliteTable(
  'cash_movements',
  {
    /** Made on the tablet; also the key of the `cash_movement` outbox row. */
    ulid: text('ulid').primaryKey(),
    shift_ulid: text('shift_ulid').notNull(),
    type: text('type', { enum: ['in', 'out'] }).notNull(),
    /** Integer centavos, 1–100000000. */
    amount_cents: integer('amount_cents').notNull(),
    reason: text('reason').notNull(),
    /** ISO 8601 UTC. */
    occurred_at: text('occurred_at').notNull(),
    user_id: integer('user_id').notNull(),
    user_name: text('user_name').notNull(),
  },
  (table) => [index('cash_movements_shift_ulid_index').on(table.shift_ulid)],
);

/**
 * Voids & Refunds (Phase 7): the refunds made **on this tablet**
 * (docs/api-contract.md → Voids & Refunds → Device rules → Local data), stored
 * after the server's `201` so the tablet's X-read and Z-read count them in the
 * refund's shift. Pruned like synced sales: after 7 days, except for the
 * current shift.
 */
export const localRefunds = sqliteTable(
  'local_refunds',
  {
    /** The refund's ULID. */
    ulid: text('ulid').primaryKey(),
    order_ulid: text('order_ulid').notNull(),
    /** The refunding tablet's shift (the refund's `shift_ulid`). */
    shift_ulid: text('shift_ulid').notNull(),
    /** The server's `Refund`, as JSON. */
    refund_json: text('refund_json').notNull(),
    /** ISO 8601 UTC. */
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('local_refunds_shift_ulid_index').on(table.shift_ulid),
    index('local_refunds_order_ulid_index').on(table.order_ulid),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type SyncStateRow = typeof syncState.$inferSelect;
export type PrintConfigRow = typeof printConfig.$inferSelect;
export type PrintJobRow = typeof printJobs.$inferSelect;
export type PrintJobInsert = typeof printJobs.$inferInsert;
export type LocalOrderRow = typeof localOrders.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
export type StockCacheRow = typeof stockCache.$inferSelect;
export type OutboxEntity = OutboxRow['entity'];
export type ShiftRow = typeof shifts.$inferSelect;
export type CashMovementRow = typeof cashMovements.$inferSelect;
export type LocalRefundRow = typeof localRefunds.$inferSelect;
