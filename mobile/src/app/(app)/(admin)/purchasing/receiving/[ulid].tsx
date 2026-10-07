import { useLocalSearchParams } from 'expo-router';

import { ReceiveScreen } from '@/components/purchasing/ReceiveScreen';
import { parseRouteUlid } from '@/utils/routeParams';

/** Receive against a PO: POST /api/v1/purchase-orders/{ulid}/receipts (idempotent). */
export default function ReceiveRoute() {
  const params = useLocalSearchParams<{ ulid?: string | string[] }>();
  return <ReceiveScreen ulid={parseRouteUlid(params.ulid)} />;
}
