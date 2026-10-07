/**
 * Sell-screen reads from the local catalogue, applying the contract's
 * **Device visibility rules** (docs/api-contract.md → Catalogue Sync), so the
 * screen shows exactly what `GET /categories` and `GET /products` would:
 * - Categories: `is_active = 1`, ordered by `sort_order`, `name COLLATE NOCASE`, `id`.
 * - Products: their category exists locally **and** is active. Unavailable
 *   products are included (greyed out on screen). Same ordering.
 * - `products_count`: available products in the category.
 * - Search: case-insensitive "contains" on `name` or `sku` (`LIKE` with `%`, `_`
 *   and the escape character itself escaped).
 */
import { and, asc, count, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { categories, products, syncState, type CategoryRow, type ProductRow } from '@/db/schema';
import { CATALOGUE_SCOPE } from '@/db/catalogueRepository';

export type MenuCategory = CategoryRow & {
  /** Available products in this category. */
  products_count: number;
};

export type MenuProduct = ProductRow;

export type MenuProductFilter = {
  /** `null`: every visible category. */
  categoryId: number | null;
  /** Trimmed search text; `''` = no search. */
  search: string;
};

/** What the local catalogue holds, for the "not synced yet" state and the header. */
export type CatalogueSummary = {
  /** Any category or product row is stored locally. */
  hasData: boolean;
  /** `meta.server_time` of the last completed sync run, or `null`. */
  serverTime: string | null;
};

const LIKE_ESCAPE = '\\';

/** Escapes `\`, `%` and `_` so user text matches literally inside a `LIKE … ESCAPE '\'` pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `${LIKE_ESCAPE}${character}`);
}

/** `%text%` for a "contains" match. */
export function containsPattern(text: string): string {
  return `%${escapeLike(text)}%`;
}

/** Visible categories, in menu order, with their available-product counts. */
export async function readMenuCategories(): Promise<MenuCategory[]> {
  const db = getDb();
  const available = db
    .select({ category_id: products.category_id, total: count().as('total') })
    .from(products)
    .where(eq(products.is_available, true))
    .groupBy(products.category_id)
    .as('available');

  const rows = db
    .select({ category: categories, total: available.total })
    .from(categories)
    .leftJoin(available, eq(available.category_id, categories.id))
    .where(eq(categories.is_active, true))
    .orderBy(asc(categories.sort_order), sql`${categories.name} COLLATE NOCASE`, asc(categories.id))
    .all();

  return rows.map(({ category, total }) => ({ ...category, products_count: total ?? 0 }));
}

/** Visible products (available or not), in menu order, filtered by category and search. */
export async function readMenuProducts(filter: MenuProductFilter): Promise<MenuProduct[]> {
  const conditions: SQL[] = [eq(categories.is_active, true)];
  if (filter.categoryId !== null) conditions.push(eq(products.category_id, filter.categoryId));

  const search = filter.search.trim();
  if (search !== '') {
    const pattern = containsPattern(search);
    conditions.push(
      sql`(${products.name} LIKE ${pattern} ESCAPE '\\' OR ${products.sku} LIKE ${pattern} ESCAPE '\\')`,
    );
  }

  const rows = getDb()
    .select({ product: products })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.category_id))
    .where(and(...conditions))
    .orderBy(asc(products.sort_order), sql`${products.name} COLLATE NOCASE`, asc(products.id))
    .all();

  return rows.map(({ product }) => product);
}

/**
 * The stored rows of these products (any visibility), to re-price a cart
 * after a catalogue sync. Ids that are no longer stored are simply missing.
 */
export async function readProductsByIds(ids: readonly number[]): Promise<MenuProduct[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(products)
    .where(inArray(products.id, [...new Set(ids)]))
    .all();
}

/**
 * The stored names of these categories (any visibility), by id: the
 * `category_name` snapshot of an offline sale's lines (Offline Sales, Phase 5).
 */
export async function readCategoryNames(ids: readonly number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (ids.length === 0) return names;
  const rows = getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(inArray(categories.id, [...new Set(ids)]))
    .all();
  for (const row of rows) names.set(row.id, row.name);
  return names;
}

/** A category a printer can take (Printing, Phase 4): active or not, in menu order. */
export type RoutableCategory = Pick<CategoryRow, 'id' | 'name' | 'is_active'>;

/**
 * Every stored category, active **and** inactive (a printer may route an
 * inactive category), ordered like the menu. For the printer form's picker.
 */
export async function readRoutableCategories(): Promise<RoutableCategory[]> {
  return getDb()
    .select({ id: categories.id, name: categories.name, is_active: categories.is_active })
    .from(categories)
    .orderBy(asc(categories.sort_order), sql`${categories.name} COLLATE NOCASE`, asc(categories.id))
    .all();
}

/** Whether anything is stored yet, and when the last run completed. */
export async function readCatalogueSummary(): Promise<CatalogueSummary> {
  const db = getDb();
  const state = db.select().from(syncState).where(eq(syncState.scope, CATALOGUE_SCOPE)).get();
  const anyCategory = db.select({ id: categories.id }).from(categories).limit(1).get();
  const anyProduct = anyCategory ? undefined : db.select({ id: products.id }).from(products).limit(1).get();

  return {
    hasData: anyCategory !== undefined || anyProduct !== undefined,
    serverTime: state?.server_time ?? null,
  };
}
