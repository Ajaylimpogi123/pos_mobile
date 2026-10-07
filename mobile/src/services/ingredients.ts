/**
 * Feature: Ingredients, Recipes & Purchasing §D: ingredients (admin CRUD,
 * `product.manage`; reads also with `inventory.adjust`, any purchase
 * permission or `report.view`) and ingredient inventory. One function per
 * contract endpoint, through the shared client (`@/services/api`).
 */
import { api, buildQuery } from '@/services/api';
import { buildImageFormData, UPLOAD_TIMEOUT_MS } from '@/services/adminCatalog';
import type {
  CursorPage,
  DataEnvelope,
  Ingredient,
  IngredientCostRequest,
  IngredientCreateRequest,
  IngredientInventoryListParams,
  IngredientInventoryPage,
  IngredientListParams,
  IngredientMovement,
  IngredientMovementListParams,
  IngredientReorderLevelRequest,
  IngredientStockAdjustmentRequest,
  IngredientStockAdjustmentResult,
  IngredientUpdateRequest,
  UploadFile,
} from '@/services/types';

const ADMIN = '/api/v1/admin/ingredients';
const INVENTORY = '/api/v1/inventory/ingredients';

/** GET /api/v1/admin/ingredients (Q-025: `search`, `is_active`; by name). */
export async function listIngredients(params: IngredientListParams = {}): Promise<CursorPage<Ingredient>> {
  return api.get<CursorPage<Ingredient>>(
    `${ADMIN}${buildQuery({ per_page: params.per_page, cursor: params.cursor, search: params.search, is_active: params.is_active })}`,
  );
}

/** POST /api/v1/admin/ingredients → 201. */
export async function createIngredient(body: IngredientCreateRequest): Promise<Ingredient> {
  const response = await api.post<DataEnvelope<Ingredient>>(ADMIN, body);
  return response.data;
}

/** GET /api/v1/admin/ingredients/{id}. */
export async function getIngredient(id: number): Promise<Ingredient> {
  const response = await api.get<DataEnvelope<Ingredient>>(`${ADMIN}/${id}`);
  return response.data;
}

/**
 * PATCH /api/v1/admin/ingredients/{id} (partial). 409 when `base_unit` changes
 * once the ingredient is in use, or a unit used on an open PO line changes.
 */
export async function updateIngredient(id: number, body: IngredientUpdateRequest): Promise<Ingredient> {
  const response = await api.patch<DataEnvelope<Ingredient>>(`${ADMIN}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/ingredients/{id} → 204. 409 while on a recipe or an open PO. */
export async function deleteIngredient(id: number): Promise<void> {
  await api.delete<void>(`${ADMIN}/${id}`);
}

/** POST /api/v1/admin/ingredients/{id}/image (multipart `image`), like products (Q-025). */
export async function uploadIngredientImage(id: number, file: UploadFile): Promise<Ingredient> {
  const response = await api.post<DataEnvelope<Ingredient>>(`${ADMIN}/${id}/image`, buildImageFormData(file), {
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
  return response.data;
}

/** DELETE /api/v1/admin/ingredients/{id}/image → 200 with the ingredient (Q-025). */
export async function deleteIngredientImage(id: number): Promise<Ingredient> {
  const response = await api.delete<DataEnvelope<Ingredient>>(`${ADMIN}/${id}/image`);
  return response.data;
}

/**
 * POST /api/v1/admin/ingredients/{id}/stock-adjustments → 201 (`inventory.adjust`).
 * Idempotent: `Idempotency-Key` = `body.ulid`. Q-026: the 201 is the movement
 * item plus `ingredient_id`, `qty_before` and `qty_after` (the notice shows `qty_after`).
 */
export async function createIngredientStockAdjustment(
  id: number,
  body: IngredientStockAdjustmentRequest,
): Promise<IngredientStockAdjustmentResult> {
  const response = await api.post<DataEnvelope<IngredientStockAdjustmentResult>>(`${ADMIN}/${id}/stock-adjustments`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}

/** GET /api/v1/inventory/ingredients: the branch's ingredients with stock; `meta.summary` counts the whole branch. */
export async function listIngredientInventory(params: IngredientInventoryListParams = {}): Promise<IngredientInventoryPage> {
  return api.get<IngredientInventoryPage>(
    `${INVENTORY}${buildQuery({ per_page: params.per_page, cursor: params.cursor, search: params.search, status: params.status })}`,
  );
}

/** GET /api/v1/inventory/ingredients/{id} → `{ data: Ingredient }` (Q-026). */
export async function getIngredientInventoryItem(id: number): Promise<Ingredient> {
  const response = await api.get<DataEnvelope<Ingredient>>(`${INVENTORY}/${id}`);
  return response.data;
}

/** GET /api/v1/inventory/ingredients/{id}/movements: newest first; `qty_after` is the running balance. */
export async function listIngredientMovements(
  id: number,
  params: IngredientMovementListParams = {},
): Promise<CursorPage<IngredientMovement>> {
  return api.get<CursorPage<IngredientMovement>>(
    `${INVENTORY}/${id}/movements${buildQuery({ per_page: params.per_page, cursor: params.cursor, type: params.type })}`,
  );
}

/** PUT /api/v1/inventory/ingredients/{id}/reorder-level (`{qty, unit}` or `null`; Q-026: wrapped in `reorder_level`). */
export async function setIngredientReorderLevel(id: number, body: IngredientReorderLevelRequest): Promise<Ingredient> {
  const response = await api.put<DataEnvelope<Ingredient>>(`${INVENTORY}/${id}/reorder-level`, body);
  return response.data;
}

/**
 * POST /api/v1/admin/ingredients/{id}/cost → 200 `{ data: Ingredient }` (§D1,
 * `inventory.adjust`). Sets the branch's average cost from the price of one
 * `unit`. Idempotent: `Idempotency-Key` = `body.ulid`, so a retry after a
 * timeout can't write a second revaluation.
 */
export async function setIngredientCost(id: number, body: IngredientCostRequest): Promise<Ingredient> {
  const response = await api.post<DataEnvelope<Ingredient>>(`${ADMIN}/${id}/cost`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}
