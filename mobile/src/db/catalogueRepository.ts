/**
 * Catalogue writes and sync bookkeeping (docs/api-contract.md → Catalogue
 * Sync → Device rules). Every write is one SQLite transaction:
 * - a **baseline** replaces both tables and saves the cursor together;
 * - a **delta page** upserts its rows, deletes its tombstones and saves its
 *   `next_cursor` together.
 * So a failure (or the app being killed) at any point leaves the previous
 * menu and the previous cursor in place.
 *
 * Drizzle's expo-sqlite driver is synchronous: a transaction runs start to
 * finish on the JS thread, so no other query can interleave with it. The
 * functions still return promises so callers (and tests) treat the store
 * as an async boundary.
 */
import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';

import { getDb, type AppDatabase } from '@/db/client';
import { categories, products, syncState, type CategoryRow, type ProductRow, type SyncStateRow } from '@/db/schema';
import type { SyncCategory, SyncDeleted, SyncProduct } from '@/services/types';
import { chunk } from '@/utils/collections';

/** `sync_state.scope` of the catalogue. */
export const CATALOGUE_SCOPE = 'catalogue';

/** Rows per multi-row INSERT (13 columns × 50 stays far below SQLite's bound-variable limit). */
const INSERT_CHUNK = 50;
/** Ids per `IN (…)` delete. */
const DELETE_CHUNK = 500;

/** What is saved with the data in the same transaction. */
export type SyncPosition = {
  cursor: string;
  apiOrigin: string;
  /** `meta.server_time` when a run completes; `undefined` keeps the stored value (a page mid-run). */
  serverTime?: string;
};

export type CatalogueSnapshot = {
  categories: readonly SyncCategory[];
  products: readonly SyncProduct[];
};

export type DeltaPage = CatalogueSnapshot & {
  deleted: SyncDeleted;
};

/** An image the Sell screen shows, to prefetch into the disk cache. */
export type VisibleImage = {
  url: string;
  /** `image_path`: changes whenever the image changes. */
  path: string | null;
};

/** The write side the sync run needs. Tests pass their own implementation. */
export type CatalogueRepository = {
  readSyncState: () => Promise<SyncStateRow | null>;
  replaceCatalogue: (snapshot: CatalogueSnapshot, position: SyncPosition) => Promise<void>;
  applyDeltaPage: (page: DeltaPage, position: SyncPosition) => Promise<void>;
  listVisibleImages: () => Promise<VisibleImage[]>;
};

type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

/** Explicit field picks: anything extra the server sends is never written. */
function toCategoryRow(category: SyncCategory): CategoryRow {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    sort_order: category.sort_order,
    is_active: category.is_active,
    image_url: category.image_url,
    image_path: category.image_path,
    updated_at: category.updated_at,
  };
}

function toProductRow(product: SyncProduct): ProductRow {
  return {
    id: product.id,
    category_id: product.category_id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    price_cents: product.price_cents,
    is_vatable: product.is_vatable,
    is_available: product.is_available,
    track_stock: product.track_stock,
    sort_order: product.sort_order,
    image_url: product.image_url,
    image_path: product.image_path,
    updated_at: product.updated_at,
  };
}

const CATEGORY_COLUMNS = [
  'name',
  'description',
  'sort_order',
  'is_active',
  'image_url',
  'image_path',
  'updated_at',
] as const satisfies readonly (keyof CategoryRow)[];

const PRODUCT_COLUMNS = [
  'category_id',
  'sku',
  'name',
  'description',
  'price_cents',
  'is_vatable',
  'is_available',
  'track_stock',
  'sort_order',
  'image_url',
  'image_path',
  'updated_at',
] as const satisfies readonly (keyof ProductRow)[];

/** `SET col = excluded.col` for an upsert (property names equal the column names). */
function fromExcluded<K extends string>(columns: readonly K[]): Record<K, SQL> {
  const set = {} as Record<K, SQL>;
  for (const column of columns) set[column] = sql.raw(`excluded.\`${column}\``);
  return set;
}

function upsertCategories(tx: Transaction, rows: readonly SyncCategory[]): void {
  for (const part of chunk(rows.map(toCategoryRow), INSERT_CHUNK)) {
    tx.insert(categories)
      .values(part)
      .onConflictDoUpdate({ target: categories.id, set: fromExcluded(CATEGORY_COLUMNS) })
      .run();
  }
}

function upsertProducts(tx: Transaction, rows: readonly SyncProduct[]): void {
  for (const part of chunk(rows.map(toProductRow), INSERT_CHUNK)) {
    tx.insert(products)
      .values(part)
      .onConflictDoUpdate({ target: products.id, set: fromExcluded(PRODUCT_COLUMNS) })
      .run();
  }
}

function savePosition(tx: Transaction, position: SyncPosition): void {
  const set: Partial<SyncStateRow> = { cursor: position.cursor, api_origin: position.apiOrigin };
  if (position.serverTime !== undefined) set.server_time = position.serverTime;
  tx.insert(syncState)
    .values({ scope: CATALOGUE_SCOPE, server_time: null, ...set })
    .onConflictDoUpdate({ target: syncState.scope, set })
    .run();
}

async function readSyncState(): Promise<SyncStateRow | null> {
  const row = getDb().select().from(syncState).where(eq(syncState.scope, CATALOGUE_SCOPE)).get();
  return row ?? null;
}

async function replaceCatalogue(snapshot: CatalogueSnapshot, position: SyncPosition): Promise<void> {
  getDb().transaction((tx) => {
    tx.delete(products).run();
    tx.delete(categories).run();
    upsertCategories(tx, snapshot.categories);
    upsertProducts(tx, snapshot.products);
    savePosition(tx, position);
  });
}

async function applyDeltaPage(page: DeltaPage, position: SyncPosition): Promise<void> {
  getDb().transaction((tx) => {
    upsertCategories(tx, page.categories);
    upsertProducts(tx, page.products);
    // Deleting an id the device doesn't have does nothing.
    for (const ids of chunk(page.deleted.categories, DELETE_CHUNK)) {
      tx.delete(categories).where(inArray(categories.id, ids)).run();
    }
    for (const ids of chunk(page.deleted.products, DELETE_CHUNK)) {
      tx.delete(products).where(inArray(products.id, ids)).run();
    }
    savePosition(tx, position);
  });
}

/**
 * Images of every row the Sell screen can show (the visibility rules):
 * active categories, and products (available or not) whose category is
 * local and active.
 */
async function listVisibleImages(): Promise<VisibleImage[]> {
  const db = getDb();
  const categoryImages = db
    .select({ url: categories.image_url, path: categories.image_path })
    .from(categories)
    .where(and(eq(categories.is_active, true), isNotNull(categories.image_url)))
    .all();
  const productImages = db
    .select({ url: products.image_url, path: products.image_path })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.category_id))
    .where(and(eq(categories.is_active, true), isNotNull(products.image_url)))
    .all();

  const images: VisibleImage[] = [];
  for (const row of [...categoryImages, ...productImages]) {
    if (row.url) images.push({ url: row.url, path: row.path });
  }
  return images;
}

/** The SQLite-backed repository used by the app. */
export const catalogueRepository: CatalogueRepository = {
  readSyncState,
  replaceCatalogue,
  applyDeltaPage,
  listVisibleImages,
};
