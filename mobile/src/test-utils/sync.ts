/**
 * Test-only fixtures for Catalogue Sync (Phase 2), shaped exactly like the
 * contract's `GET /api/v1/sync/catalogue` response. Never import from app code.
 */
import type {
  CatalogueSyncMeta,
  CatalogueSyncResponse,
  SyncCategory,
  SyncDeleted,
  SyncProduct,
} from '@/services/types';

export const SERVER_TIME = '2026-09-24T01:05:12Z';

/** A `SyncCategory` (the contract example), with overrides. */
export function syncCategory(overrides: Partial<SyncCategory> & { id: number }): SyncCategory {
  return {
    name: `Category ${overrides.id}`,
    description: null,
    sort_order: 0,
    is_active: true,
    image_url: null,
    image_path: null,
    updated_at: '2026-09-24T01:00:00Z',
    ...overrides,
  };
}

/** A `SyncProduct` (the contract example, no `cost_cents`), with overrides. */
export function syncProduct(overrides: Partial<SyncProduct> & { id: number; category_id: number }): SyncProduct {
  return {
    sku: null,
    name: `Product ${overrides.id}`,
    description: null,
    price_cents: 5000,
    is_vatable: true,
    is_available: true,
    track_stock: false,
    sort_order: 0,
    image_url: null,
    image_path: null,
    updated_at: '2026-09-24T01:00:00Z',
    ...overrides,
  };
}

type PageInput = {
  categories?: SyncCategory[];
  products?: SyncProduct[];
  deleted?: Partial<SyncDeleted>;
  meta?: Partial<CatalogueSyncMeta>;
};

/** A full response body. Defaults: a single-page baseline. */
export function syncPage(input: PageInput = {}): CatalogueSyncResponse {
  return {
    data: {
      categories: input.categories ?? [],
      products: input.products ?? [],
      deleted: { categories: input.deleted?.categories ?? [], products: input.deleted?.products ?? [] },
    },
    meta: {
      full: true,
      has_more: false,
      next_cursor: 'cursor-end',
      server_time: SERVER_TIME,
      ...input.meta,
    },
  };
}

/** The contract's dev seed menu: Breakfast, Meals, Drinks and five products. */
export function seedMenu(): { categories: SyncCategory[]; products: SyncProduct[] } {
  return {
    categories: [
      syncCategory({ id: 1, name: 'Breakfast', sort_order: 10 }),
      syncCategory({ id: 2, name: 'Meals', sort_order: 20 }),
      syncCategory({ id: 3, name: 'Drinks', sort_order: 30 }),
    ],
    products: [
      syncProduct({ id: 1, category_id: 1, sku: 'BRK-001', name: 'Egg with Rice', price_cents: 5000 }),
      syncProduct({ id: 2, category_id: 1, sku: 'BRK-002', name: 'Hot Dog', price_cents: 8000 }),
      syncProduct({ id: 3, category_id: 2, sku: 'MLS-001', name: 'Fried Chicken', price_cents: 10000 }),
      syncProduct({ id: 4, category_id: 3, sku: 'DRK-001', name: 'Iced Tea', price_cents: 3500, track_stock: true }),
      syncProduct({ id: 5, category_id: 3, sku: 'DRK-002', name: 'Bottled Water', price_cents: 2000, track_stock: true }),
    ],
  };
}
