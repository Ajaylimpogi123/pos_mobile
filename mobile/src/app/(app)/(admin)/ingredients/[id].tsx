import { useLocalSearchParams } from 'expo-router';

import { IngredientFormScreen } from '@/components/ingredients/IngredientFormScreen';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { ROUTES } from '@/constants/routes';
import { useIngredient } from '@/hooks/ingredients/useIngredients';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { parseRouteId } from '@/utils/routeParams';

/**
 * One ingredient: GET /api/v1/admin/ingredients/{id}, then the form. A
 * background refetch never unmounts the form, so typed input is kept.
 */
export default function IngredientRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ingredientId = parseRouteId(id);
  const query = useIngredient(ingredientId);

  if (query.data) return <IngredientFormScreen ingredient={query.data} />;

  const error = ingredientId === null ? new ApiError('This ingredient does not exist.', { status: 404, kind: 'http' }) : query.error;
  return (
    <RecordLoadState
      title="Ingredient"
      error={error}
      onRetry={() => void query.refetch()}
      onBack={() => goBackOr(ROUTES.ingredients)}
      testID="ingredient-load-state"
    />
  );
}
