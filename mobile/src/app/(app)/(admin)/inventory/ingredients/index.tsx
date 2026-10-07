import { IngredientStockListScreen } from '@/components/inventory/IngredientStockListScreen';

/** Inventory → Ingredients: GET /api/v1/inventory/ingredients (`?status=alerts` opens the Low & out filter). */
export default function IngredientStockIndexRoute() {
  return <IngredientStockListScreen />;
}
