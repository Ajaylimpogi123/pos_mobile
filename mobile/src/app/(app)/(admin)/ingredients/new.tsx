import { IngredientFormScreen } from '@/components/ingredients/IngredientFormScreen';

/** New ingredient: POST /api/v1/admin/ingredients, then the image upload. */
export default function NewIngredientRoute() {
  return <IngredientFormScreen />;
}
