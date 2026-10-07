import { router } from 'expo-router';

import { PurchaseRequestFormScreen } from '@/components/purchasing/PurchaseRequestFormScreen';
import { purchaseRequestRoute, ROUTES } from '@/constants/routes';
import { goBackOr } from '@/utils/navigation';

/** New purchase request: POST /api/v1/purchase-requests (idempotent), then its detail. */
export default function NewPurchaseRequestRoute() {
  return (
    <PurchaseRequestFormScreen
      onBack={() => goBackOr(ROUTES.purchaseRequests)}
      onSaved={(pr) => router.replace(purchaseRequestRoute(pr.ulid))}
    />
  );
}
