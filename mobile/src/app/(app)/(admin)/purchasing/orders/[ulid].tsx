import { useLocalSearchParams } from 'expo-router';

import { PurchaseOrderDetailScreen } from '@/components/purchasing/PurchaseOrderDetailScreen';
import { parseRouteUlid } from '@/utils/routeParams';

/** One purchase order: GET /api/v1/purchase-orders/{ulid}, approve / decline, edits while pending. */
export default function PurchaseOrderRoute() {
  const params = useLocalSearchParams<{ ulid?: string | string[] }>();
  return <PurchaseOrderDetailScreen ulid={parseRouteUlid(params.ulid)} />;
}
