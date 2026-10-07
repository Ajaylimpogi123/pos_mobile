/**
 * Feature: Ingredients, Recipes & Purchasing §J (Round B): a product's recipe
 * (permission `product.manage`; only for `stock_mode = recipe`). One function
 * per contract endpoint.
 */
import { api } from '@/services/api';
import type { AdminProduct, DataEnvelope, Recipe, RecipeUpdateRequest } from '@/services/types';

function recipePath(productId: number): string {
  return `/api/v1/admin/products/${productId}/recipe`;
}

/** GET /api/v1/admin/products/{id}/recipe → the lines per serving, with their cost and the margin. */
export async function getRecipe(productId: number): Promise<Recipe> {
  const response = await api.get<DataEnvelope<Recipe>>(recipePath(productId));
  return response.data;
}

/**
 * PUT /api/v1/admin/products/{id}/recipe: replaces the whole recipe (0..50
 * lines). 422 keys: `lines`, `lines.{i}.component_type|component_id|qty|unit`.
 */
export async function updateRecipe(productId: number, body: RecipeUpdateRequest): Promise<Recipe> {
  const response = await api.put<DataEnvelope<Recipe>>(recipePath(productId), body);
  return response.data;
}

/**
 * POST /api/v1/admin/products/{id}/recipe/apply-cost: sets the product's
 * `cost_cents` to the recipe cost (audited) → `200 { data: Product }` (Q-031);
 * 409 when the product doesn't use a recipe. `null` when the answer isn't a
 * product, so the caller refetches it.
 */
export async function applyRecipeCost(productId: number): Promise<AdminProduct | null> {
  const response = await api.post<DataEnvelope<AdminProduct> | null | undefined>(`${recipePath(productId)}/apply-cost`);
  const data = response?.data;
  return data && typeof data === 'object' && typeof data.cost_cents === 'number' ? data : null;
}
