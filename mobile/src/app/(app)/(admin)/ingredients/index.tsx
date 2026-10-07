import { IngredientListScreen } from '@/components/ingredients/IngredientListScreen';

/** Ingredients: GET /api/v1/admin/ingredients (`product.manage`). */
export default function IngredientsIndexRoute() {
  return <IngredientListScreen />;
}
