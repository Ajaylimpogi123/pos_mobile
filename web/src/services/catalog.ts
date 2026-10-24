/**
 * Catalogue read endpoints (any authenticated user), plus the admin category
 * list for the printer route picker (`product.manage`). One function per endpoint.
 */
import { api, buildQuery } from '@/services/api';
import type { AdminCategoryListParams, Category, CursorPage, CursorParams, Product, ProductListParams } from '@/services/types';

/** GET /api/v1/categories: active categories; `products_count` = available products. */
export async function listCategories(params: CursorParams = {}): Promise<CursorPage<Category>> {
  return api.get<CursorPage<Category>>(`/api/v1/categories${buildQuery({ per_page: params.per_page, cursor: params.cursor })}`);
}

/** GET /api/v1/products: unavailable products included; no `cost_cents`. */
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

/** GET /api/v1/admin/categories (`product.manage`): inactive categories included; `search` on name, `is_active` filter. */
export async function listAdminCategories(params: AdminCategoryListParams = {}): Promise<CursorPage<Category>> {
  return api.get<CursorPage<Category>>(
    `/api/v1/admin/categories${buildQuery({ per_page: params.per_page, cursor: params.cursor, search: params.search, is_active: params.is_active })}`,
  );
}
