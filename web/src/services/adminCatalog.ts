/**
 * Admin catalogue (Catalogue: Categories & Products → Admin, permission
 * `product.manage`; the server answers 403 without it). One function per
 * endpoint. The admin category list lives in `./catalog` (the printers page
 * reads it too).
 *
 * Images go up separately from the JSON, as `multipart/form-data` with one
 * `image` field (Global Conventions → File uploads).
 */
import { api, buildQuery } from '@/services/api';
import type {
  AdminProduct,
  AdminProductListParams,
  Category,
  CategoryCreateRequest,
  CategoryUpdateRequest,
  CursorPage,
  DataEnvelope,
  ProductCreateRequest,
  ProductUpdateRequest,
} from '@/services/types';

const CATEGORIES = '/api/v1/admin/categories';
const PRODUCTS = '/api/v1/admin/products';

function imageForm(file: Blob, name: string): FormData {
  const form = new FormData();
  form.append('image', file, name);
  return form;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** GET /api/v1/admin/categories/{id}. */
export async function getAdminCategory(id: number): Promise<Category> {
  const response = await api.get<DataEnvelope<Category>>(`${CATEGORIES}/${id}`);
  return response.data;
}

/** POST /api/v1/admin/categories → 201. */
export async function createCategory(body: CategoryCreateRequest): Promise<Category> {
  const response = await api.post<DataEnvelope<Category>>(CATEGORIES, body);
  return response.data;
}

/** PATCH /api/v1/admin/categories/{id}: partial. */
export async function updateCategory(id: number, body: CategoryUpdateRequest): Promise<Category> {
  const response = await api.patch<DataEnvelope<Category>>(`${CATEGORIES}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/categories/{id} → 204. 409 while it still has products. */
export async function deleteCategory(id: number): Promise<void> {
  await api.delete<void>(`${CATEGORIES}/${id}`);
}

/** POST /api/v1/admin/categories/{id}/image (multipart `image`): replaces the image. */
export async function uploadCategoryImage(id: number, file: Blob, name: string): Promise<Category> {
  const response = await api.post<DataEnvelope<Category>>(`${CATEGORIES}/${id}/image`, imageForm(file, name));
  return response.data;
}

/** DELETE /api/v1/admin/categories/{id}/image: clears `image_url` / `image_path`. */
export async function deleteCategoryImage(id: number): Promise<Category> {
  const response = await api.delete<DataEnvelope<Category>>(`${CATEGORIES}/${id}/image`);
  return response.data;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** GET /api/v1/admin/products: products in inactive categories included; `cost_cents`, `stock_qty`, `stock_mode`. */
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

/** GET /api/v1/admin/products/{id}. */
export async function getAdminProduct(id: number): Promise<AdminProduct> {
  const response = await api.get<DataEnvelope<AdminProduct>>(`${PRODUCTS}/${id}`);
  return response.data;
}

/** POST /api/v1/admin/products → 201. Money fields are JSON integers (centavos). */
export async function createProduct(body: ProductCreateRequest): Promise<AdminProduct> {
  const response = await api.post<DataEnvelope<AdminProduct>>(PRODUCTS, body);
  return response.data;
}

/** PATCH /api/v1/admin/products/{id}: partial. Leaving `own` with stock → 409. */
export async function updateProduct(id: number, body: ProductUpdateRequest): Promise<AdminProduct> {
  const response = await api.patch<DataEnvelope<AdminProduct>>(`${PRODUCTS}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/products/{id} → 204 (soft delete, no conflict rule). */
export async function deleteProduct(id: number): Promise<void> {
  await api.delete<void>(`${PRODUCTS}/${id}`);
}

/** POST /api/v1/admin/products/{id}/image (multipart `image`). */
export async function uploadProductImage(id: number, file: Blob, name: string): Promise<AdminProduct> {
  const response = await api.post<DataEnvelope<AdminProduct>>(`${PRODUCTS}/${id}/image`, imageForm(file, name));
  return response.data;
}

/** DELETE /api/v1/admin/products/{id}/image. */
export async function deleteProductImage(id: number): Promise<AdminProduct> {
  const response = await api.delete<DataEnvelope<AdminProduct>>(`${PRODUCTS}/${id}/image`);
  return response.data;
}
