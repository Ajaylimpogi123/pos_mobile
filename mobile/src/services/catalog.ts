/**
 * Feature: Catalogue: Categories & Products (Phase 1a): read endpoints (any
 * authenticated user). One function per contract endpoint. The POS screens
 * will use these; the menu admin uses `@/services/adminCatalog`.
 */
import { api, buildQuery } from '@/services/api';
import type { Category, CategoryListParams, CursorPage, Product, ProductListParams } from '@/services/types';

/** GET /api/v1/categories: active categories, `products_count` = available products. */
export async function listCategories(params: CategoryListParams = {}): Promise<CursorPage<Category>> {
  return api.get<CursorPage<Category>>(
    `/api/v1/categories${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`,
  );
}

/** GET /api/v1/products: includes unavailable products; items have **no** `cost_cents`. */
export async function listProducts(params: ProductListParams = {}): Promise<CursorPage<Product>> {
  return api.get<CursorPage<Product>>(
    `/api/v1/products${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      category_id: params.category_id,
      search: params.search,
    })}`,
  );
}
