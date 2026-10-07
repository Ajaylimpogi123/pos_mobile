import { useLocalSearchParams } from 'expo-router';

import { CustomerFormScreen } from '@/components/customers/CustomerFormScreen';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { ROUTES } from '@/constants/routes';
import { useCustomer } from '@/hooks/customers/useCustomers';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { parseRouteId } from '@/utils/routeParams';

/**
 * One customer: GET /api/v1/customers/{id}, then the form. A background
 * refetch never unmounts the form, so typed input is never reset.
 */
export default function CustomerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = parseRouteId(id);
  const query = useCustomer(customerId);

  if (query.data) return <CustomerFormScreen customer={query.data} />;

  const error = customerId === null ? new ApiError('This customer does not exist.', { status: 404, kind: 'http' }) : query.error;

  return (
    <RecordLoadState
      title="Customer"
      error={error}
      onRetry={() => void query.refetch()}
      onBack={() => goBackOr(ROUTES.customers)}
      testID="customer-load-state"
    />
  );
}
