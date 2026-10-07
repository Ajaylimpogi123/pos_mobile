import { useLocalSearchParams } from 'expo-router';

import { IngredientStockDetailScreen } from '@/components/inventory/IngredientStockDetailScreen';
import { parseRouteId } from '@/utils/routeParams';

/** One ingredient's stock: summary, adjust / count / wastage, reorder level, and its movement history. */
export default function IngredientStockRoute() {
  const params = useLocalSearchParams<{ ingredientId?: string | string[] }>();
  return <IngredientStockDetailScreen ingredientId={parseRouteId(params.ingredientId)} />;
}
