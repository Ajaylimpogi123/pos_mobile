import { useLocalSearchParams } from 'expo-router';

import { PurchaseRequestDetailScreen } from '@/components/purchasing/PurchaseRequestDetailScreen';
import { parseRouteUlid } from '@/utils/routeParams';

/** One purchase request: GET /api/v1/purchase-requests/{ulid}, the decisions and the timeline. */
export default function PurchaseRequestRoute() {
  const params = useLocalSearchParams<{ ulid?: string | string[] }>();
  return <PurchaseRequestDetailScreen ulid={parseRouteUlid(params.ulid)} />;
}
