import { useLocalSearchParams } from 'expo-router';

import { OrderDetailScreen } from '@/components/orders/OrderDetailScreen';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { ROUTES } from '@/constants/routes';
import { useOrderDetail } from '@/hooks/orders/useOrders';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { isUlid } from '@/utils/ulid';

/**
 * One order, shown receipt-style: GET /api/v1/orders/{ulid} (an order the user
 * can't see is a 404), or, for a sale saved on this tablet that hasn't synced
 * yet, its local order (Offline Sales).
 */
export default function OrderRoute() {
  const { ulid } = useLocalSearchParams<{ ulid: string }>();
  const raw = Array.isArray(ulid) ? ulid[0] : ulid;
  const orderUlid = raw && isUlid(raw) ? raw : null;
  const { source, query } = useOrderDetail(orderUlid);

  if (source?.kind === 'local') {
    return <OrderDetailScreen order={source.order} local={{ badge: source.badge, lastError: source.lastError }} />;
  }
  if (source) return <OrderDetailScreen order={source.order} />;

  const error = orderUlid === null ? new ApiError('This order does not exist.', { status: 404, kind: 'http' }) : query.error;

  return (
    <RecordLoadState
      title="Order"
      error={error}
      onRetry={() => void query.refetch()}
      onBack={() => goBackOr(ROUTES.orders)}
      testID="order-load-state"
    />
  );
}
