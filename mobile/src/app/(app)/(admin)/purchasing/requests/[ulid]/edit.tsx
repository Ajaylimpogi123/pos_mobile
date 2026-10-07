import { useLocalSearchParams } from 'expo-router';

import { PurchaseRequestFormScreen } from '@/components/purchasing/PurchaseRequestFormScreen';
import { PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { purchaseRequestRoute, ROUTES } from '@/constants/routes';
import { usePurchaseRequest } from '@/hooks/purchasing/usePurchaseRequests';
import { useIsOnline } from '@/hooks/useIsOnline';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { parseRouteUlid } from '@/utils/routeParams';

/** Edit a purchase request while no item is decided (PATCH; a 409 shows in the form banner). */
export default function EditPurchaseRequestRoute() {
  const params = useLocalSearchParams<{ ulid?: string | string[] }>();
  const ulid = parseRouteUlid(params.ulid);
  const query = usePurchaseRequest(ulid);
  const online = useIsOnline();
  const back = () => goBackOr(ulid ? purchaseRequestRoute(ulid) : ROUTES.purchaseRequests);

  if (query.data) return <PurchaseRequestFormScreen request={query.data} onBack={back} onSaved={back} />;

  let error: unknown = query.error;
  if (ulid === null) error = new ApiError('This purchase request was not found.', { status: 404, kind: 'http' });
  else if (!online) error = new ApiError(PURCHASING_OFFLINE_MESSAGE, { status: null, kind: 'network' });
  return <RecordLoadState title="Purchase request" error={error} onRetry={() => void query.refetch()} onBack={back} testID="pr-edit-state" />;
}
