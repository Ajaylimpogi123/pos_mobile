/**
 * Recipes (Ingredients, Recipes & Purchasing §J, Q-031/Q-032; permission
 * `product.manage`), plus the reads the recipe builder needs: the unit catalog
 * (`GET /units`, any user) and the admin ingredient list (§D, Q-025).
 */
import { api, buildQuery } from '@/services/api';
import type {
  AdminProduct,
  CursorPage,
  DataEnvelope,
  Ingredient,
  IngredientListParams,
  Recipe,
  RecipeUpdateRequest,
  Unit,
  UnitListResponse,
} from '@/services/types';

/** GET /api/v1/admin/products/{id}/recipe: the kept lines per serving (for any stock mode). */
export async function getRecipe(productId: number): Promise<Recipe> {
  const response = await api.get<DataEnvelope<Recipe>>(`/api/v1/admin/products/${productId}/recipe`);
  return response.data;
}

/** PUT /api/v1/admin/products/{id}/recipe: the whole recipe. 409 when the product isn't `recipe`. */
export async function updateRecipe(productId: number, body: RecipeUpdateRequest): Promise<Recipe> {
  const response = await api.put<DataEnvelope<Recipe>>(`/api/v1/admin/products/${productId}/recipe`, body);
  return response.data;
}

/** POST /api/v1/admin/products/{id}/recipe/apply-cost → the admin product with the recipe's `cost_cents`. */
export async function applyRecipeCost(productId: number): Promise<AdminProduct | null> {
  const response = await api.post<DataEnvelope<AdminProduct> | undefined>(`/api/v1/admin/products/${productId}/recipe/apply-cost`);
  return response?.data ?? null;
}

/** GET /api/v1/units: the seeded catalog, not paginated (Q-025). */
export async function listUnits(): Promise<Unit[]> {
  const response = await api.get<UnitListResponse>('/api/v1/units');
  return response.data;
}

/** GET /api/v1/admin/ingredients: `search` (name), `is_active`; by name then id. */
export async function listAdminIngredients(params: IngredientListParams = {}): Promise<CursorPage<Ingredient>> {
  return api.get<CursorPage<Ingredient>>(
    `/api/v1/admin/ingredients${buildQuery({
      per_page: params.per_page,
      cursor: params.cursor,
      search: params.search,
      is_active: params.is_active,
    })}`,
  );
}

/** GET /api/v1/admin/ingredients/{id}: its units and branch `avg_cost`. */
export async function getAdminIngredient(id: number): Promise<Ingredient> {
  const response = await api.get<DataEnvelope<Ingredient>>(`/api/v1/admin/ingredients/${id}`);
  return response.data;
}
