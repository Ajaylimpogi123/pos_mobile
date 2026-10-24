/**
 * Ingredients (Ingredients, Recipes & Purchasing §D, §D1; Q-025, Q-026, Q-033):
 * the admin CRUD (`product.manage`; reads also with `inventory.adjust`, any
 * purchase permission or `report.view`), the image, the ingredient inventory
 * (reads with `inventory.adjust` or `report.view`), the stock adjustments, the
 * reorder level and Set cost (`inventory.adjust`). The admin list and read
 * live in `./recipes` (the recipe builder reads them too).
 */
import { api, buildQuery } from '@/services/api';
import type {
  CursorPage,
  DataEnvelope,
  Ingredient,
  IngredientCostRequest,
  IngredientCreateRequest,
  IngredientInventoryListParams,
  IngredientInventoryPage,
  IngredientMovement,
  IngredientMovementListParams,
  IngredientReorderLevelRequest,
  IngredientStockAdjustmentRequest,
  IngredientStockAdjustmentResult,
  IngredientUpdateRequest,
} from '@/services/types';

export { getAdminIngredient, listAdminIngredients } from '@/services/recipes';

const ADMIN = '/api/v1/admin/ingredients';
const INVENTORY = '/api/v1/inventory/ingredients';

/** POST /api/v1/admin/ingredients → 201. */
export async function createIngredient(body: IngredientCreateRequest): Promise<Ingredient> {
  const response = await api.post<DataEnvelope<Ingredient>>(ADMIN, body);
  return response.data;
}

/** PATCH /api/v1/admin/ingredients/{id}: partial; `units` replaces the set. 409 on a locked base unit or a unit on an open PO. */
export async function updateIngredient(id: number, body: IngredientUpdateRequest): Promise<Ingredient> {
  const response = await api.patch<DataEnvelope<Ingredient>>(`${ADMIN}/${id}`, body);
  return response.data;
}

/** DELETE /api/v1/admin/ingredients/{id} → 204. 409 while on a recipe or an open PO. */
export async function deleteIngredient(id: number): Promise<void> {
  await api.delete<void>(`${ADMIN}/${id}`);
}

/** POST /api/v1/admin/ingredients/{id}/image (multipart `image`) → the ingredient. */
export async function uploadIngredientImage(id: number, file: Blob, name: string): Promise<Ingredient> {
  const form = new FormData();
  form.append('image', file, name);
  const response = await api.post<DataEnvelope<Ingredient>>(`${ADMIN}/${id}/image`, form);
  return response.data;
}

/** DELETE /api/v1/admin/ingredients/{id}/image → the ingredient. */
export async function deleteIngredientImage(id: number): Promise<Ingredient> {
  const response = await api.delete<DataEnvelope<Ingredient>>(`${ADMIN}/${id}/image`);
  return response.data;
}

/** POST /api/v1/admin/ingredients/{id}/stock-adjustments → 201. Idempotent: `Idempotency-Key` = `ulid`. */
export async function createIngredientStockAdjustment(id: number, body: IngredientStockAdjustmentRequest): Promise<IngredientStockAdjustmentResult> {
  const response = await api.post<DataEnvelope<IngredientStockAdjustmentResult>>(`${ADMIN}/${id}/stock-adjustments`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}

/** POST /api/v1/admin/ingredients/{id}/cost (§D1) → 200 with the ingredient. Idempotent: `Idempotency-Key` = `ulid`. */
export async function setIngredientCost(id: number, body: IngredientCostRequest): Promise<Ingredient> {
  const response = await api.post<DataEnvelope<Ingredient>>(`${ADMIN}/${id}/cost`, body, {
    headers: { 'Idempotency-Key': body.ulid },
  });
  return response.data;
}

/** GET /api/v1/inventory/ingredients: by name; `meta.summary` is branch-wide. */
export async function listIngredientInventory(params: IngredientInventoryListParams = {}): Promise<IngredientInventoryPage> {
  return api.get<IngredientInventoryPage>(
    `${INVENTORY}${buildQuery({ per_page: params.per_page, cursor: params.cursor, search: params.search, status: params.status })}`,
  );
}

/** GET /api/v1/inventory/ingredients/{id}. */
export async function getIngredientInventoryItem(id: number): Promise<Ingredient> {
  const response = await api.get<DataEnvelope<Ingredient>>(`${INVENTORY}/${id}`);
  return response.data;
}

/** GET /api/v1/inventory/ingredients/{id}/movements: newest first, optional `type` (incl. `revaluation`). */
export async function listIngredientMovements(id: number, params: IngredientMovementListParams = {}): Promise<CursorPage<IngredientMovement>> {
  return api.get<CursorPage<IngredientMovement>>(
    `${INVENTORY}/${id}/movements${buildQuery({ per_page: params.per_page, cursor: params.cursor, type: params.type })}`,
  );
}

/** PUT /api/v1/inventory/ingredients/{id}/reorder-level: `{ reorder_level: {qty, unit} | null }` → the ingredient. */
export async function setIngredientReorderLevel(id: number, body: IngredientReorderLevelRequest): Promise<Ingredient> {
  const response = await api.put<DataEnvelope<Ingredient>>(`${INVENTORY}/${id}/reorder-level`, body);
  return response.data;
}
