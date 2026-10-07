/**
 * Feature: Catalogue: Categories & Products (Phase 1a): admin endpoints
 * (permission `product.manage`; the server answers 403 without it).
 * One function per contract endpoint.
 *
 * Images are uploaded separately from JSON, as multipart with a single file
 * field `image` (Global Conventions → File uploads). The shared client sends a
 * `FormData` body without a JSON Content-Type so fetch adds the boundary.
 */
import { api, buildQuery } from '@/services/api';
import type {
  AdminCategoryListParams,
  AdminProduct,
  AdminProductListParams,
  Category,
  CategoryCreateRequest,
  CategoryUpdateRequest,
  CursorPage,
  DataEnvelope,
  ProductCreateRequest,
  ProductUpdateRequest,
  StockAdjustmentRequest,
  StockMovement,
  UploadFile,
} from '@/services/types';

/** Uploads send up to ~1 MB over shop Wi-Fi: allow longer than a JSON call. */
export const UPLOAD_TIMEOUT_MS = 60_000;

/** The multipart body for an image upload: one file field named `image`. */
export function buildImageFormData(file: UploadFile): FormData {
  const form = new FormData();
  // React Native's FormData accepts a `{ uri, name, type }` file part; DOM typings only know Blob.
  form.append('image', file as unknown as Blob);
  return form;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORIES = '/api/v1/admin/categories';

/** GET /api/v1/admin/categories: includes inactive; `products_count` = all non-deleted products. */
export async function listAdminCategories(params: AdminCategoryListParams = {}): Promise<CursorPage<Category>> {
  return api.get<CursorPage<Category>>(
    `${CATEGORIES}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      search: params.search,
      is_active: params.is_active,
    })}`,
  );
}

/** POST /api/v1/admin/categories → 201. */
export async function createCategory(body: CategoryCreateRequest): Promise<Category> {
  const response = await api.post<DataEnvelope<Category>>(CATEGORIES, body);
  return response.data;
}

/** GET /api/v1/admin/categories/{id}. */
export async function getAdminCategory(id: number): Promise<Category> {
  const response = await api.get<DataEnvelope<Category>>(`${CATEGORIES}/${id}`);
  return response.data;
}

/** PATCH /api/v1/admin/categories/{id}: partial update. */
export async function updateCategory(id: number, body: CategoryUpdateRequest): Promise<Category> {
  const response = await api.patch<DataEnvelope<Category>>(`${CATEGORIES}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/categories/{id} → 204. 409 while the category still has products. */
export async function deleteCategory(id: number): Promise<void> {
  await api.delete<void>(`${CATEGORIES}/${id}`);
}

/** POST /api/v1/admin/categories/{id}/image (multipart `image`). Replaces any existing image. */
export async function uploadCategoryImage(id: number, file: UploadFile): Promise<Category> {
  const response = await api.post<DataEnvelope<Category>>(`${CATEGORIES}/${id}/image`, buildImageFormData(file), {
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
  return response.data;
}

/** DELETE /api/v1/admin/categories/{id}/image → 200 with the category (image cleared). */
export async function deleteCategoryImage(id: number): Promise<Category> {
  const response = await api.delete<DataEnvelope<Category>>(`${CATEGORIES}/${id}/image`);
  return response.data;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const PRODUCTS = '/api/v1/admin/products';

/** GET /api/v1/admin/products: includes products in inactive categories; items carry `cost_cents`. */
export async function listAdminProducts(params: AdminProductListParams = {}): Promise<CursorPage<AdminProduct>> {
  return api.get<CursorPage<AdminProduct>>(
    `${PRODUCTS}${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      search: params.search,
      category_id: params.category_id,
      is_available: params.is_available,
    })}`,
  );
}

/** POST /api/v1/admin/products → 201. Money fields are JSON integers. */
export async function createProduct(body: ProductCreateRequest): Promise<AdminProduct> {
  const response = await api.post<DataEnvelope<AdminProduct>>(PRODUCTS, body);
  return response.data;
}

/** GET /api/v1/admin/products/{id}. */
export async function getAdminProduct(id: number): Promise<AdminProduct> {
  const response = await api.get<DataEnvelope<AdminProduct>>(`${PRODUCTS}/${id}`);
  return response.data;
}

/** PATCH /api/v1/admin/products/{id}: partial update (e.g. `{ is_available }` from the list switch). */
export async function updateProduct(id: number, body: ProductUpdateRequest): Promise<AdminProduct> {
  const response = await api.patch<DataEnvelope<AdminProduct>>(`${PRODUCTS}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/products/{id} → 204 (soft delete, no conflict rule). */
export async function deleteProduct(id: number): Promise<void> {
  await api.delete<void>(`${PRODUCTS}/${id}`);
}

/** POST /api/v1/admin/products/{id}/image (multipart `image`). Replaces any existing image. */
export async function uploadProductImage(id: number, file: UploadFile): Promise<AdminProduct> {
  const response = await api.post<DataEnvelope<AdminProduct>>(`${PRODUCTS}/${id}/image`, buildImageFormData(file), {
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
  return response.data;
}

/** DELETE /api/v1/admin/products/{id}/image → 200 with the product (image cleared). */
export async function deleteProductImage(id: number): Promise<AdminProduct> {
  const response = await api.delete<DataEnvelope<AdminProduct>>(`${PRODUCTS}/${id}/image`);
  return response.data;
}

// ---------------------------------------------------------------------------
// Stock (Core Sale, Phase 3; permission `inventory.adjust`)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/admin/products/{id}/stock-adjustments → 201 `{ data: StockMovement }`.
 * Idempotent: `Idempotency-Key` = `body.ulid`. 409 when the product doesn't track stock.
 */
export async function createStockAdjustment(productId: number, body: StockAdjustmentRequest): Promise<StockMovement> {
  const response = await api.post<DataEnvelope<StockMovement>>(`${PRODUCTS}/${productId}/stock-adjustments`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}
