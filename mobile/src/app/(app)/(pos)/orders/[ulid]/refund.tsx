import { useLocalSearchParams } from 'expo-router';

import { RefundScreen } from '@/components/orders/RefundScreen';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { orderRoute, ROUTES } from '@/constants/routes';
import { useRefundScreen } from '@/hooks/orders/useRefundScreen';
import { ApiError } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { goBackOr } from '@/utils/navigation';
import { hasAnyPermission, PERMISSIONS } from '@/utils/permissions';
import { isUlid } from '@/utils/ulid';

/**
 * Refund an order (Voids & Refunds, Phase 7): GET /api/v1/orders/{ulid}, then
 * POST /api/v1/orders/{ulid}/refunds. Needs `sale.create` or `sale.refund`
 * (a UI hint: the server enforces).
 */
export default function RefundRoute() {
  const { ulid } = useLocalSearchParams<{ ulid: string }>();
  const raw = Array.isArray(ulid) ? ulid[0] : ulid;
  const orderUlid = raw && isUlid(raw) ? raw : null;
  const allowed = useSessionStore((state) => hasAnyPermission(state.user, [PERMISSIONS.saleCreate, PERMISSIONS.saleRefund]));
  const refund = useRefundScreen(allowed ? orderUlid : null);
  const order = refund.done?.order ?? refund.order;

  if (allowed && order) return <RefundScreen refund={refund} order={order} />;

  let error: unknown = refund.query.error;
  if (!allowed) error = new ApiError('You do not have permission to refund sales.', { status: 403, kind: 'http' });
  else if (orderUlid === null) error = new ApiError('This order does not exist.', { status: 404, kind: 'http' });

  return (
    <RecordLoadState
      title="Refund"
      error={error}
      onRetry={() => void refund.query.refetch()}
      onBack={() => goBackOr(orderUlid ? orderRoute(orderUlid) : ROUTES.orders)}
      testID="refund-load-state"
    />
  );
}
