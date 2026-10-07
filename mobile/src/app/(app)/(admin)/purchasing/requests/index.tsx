import { PurchaseRequestListScreen } from '@/components/purchasing/PurchaseRequestListScreen';

/** Purchase requests: GET /api/v1/purchase-requests (`?view=decision` opens Needs my decision). */
export default function PurchaseRequestsIndexRoute() {
  return <PurchaseRequestListScreen />;
}
