import { useLocalSearchParams } from 'expo-router';

import { InventoryDetailScreen } from '@/components/inventory/InventoryDetailScreen';
import { parseRouteId } from '@/utils/routeParams';

/** One product's stock: summary, stock in / count / wastage, reorder level, and its movement history. */
export default function InventoryItemRoute() {
  const params = useLocalSearchParams<{ productId?: string | string[] }>();
  return <InventoryDetailScreen productId={parseRouteId(params.productId)} />;
}
