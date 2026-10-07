import { useLocalSearchParams } from 'expo-router';

import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { SupplierFormScreen } from '@/components/suppliers/SupplierFormScreen';
import { ROUTES } from '@/constants/routes';
import { useSupplier } from '@/hooks/suppliers/useSuppliers';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { parseRouteId } from '@/utils/routeParams';

/** One supplier: GET /api/v1/admin/suppliers/{id}, then the form (read-only without `supplier.manage`). */
export default function SupplierRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const supplierId = parseRouteId(id);
  const query = useSupplier(supplierId);

  if (query.data) return <SupplierFormScreen supplier={query.data} />;

  const error = supplierId === null ? new ApiError('This supplier does not exist.', { status: 404, kind: 'http' }) : query.error;
  return (
    <RecordLoadState
      title="Supplier"
      error={error}
      onRetry={() => void query.refetch()}
      onBack={() => goBackOr(ROUTES.suppliers)}
      testID="supplier-load-state"
    />
  );
}
