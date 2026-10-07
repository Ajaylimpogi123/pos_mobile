import { useLocalSearchParams } from 'expo-router';

import { ProductFormScreen } from '@/components/menu/ProductFormScreen';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { ROUTES } from '@/constants/routes';
import { useAdminProduct } from '@/hooks/menu/useAdminProducts';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { parseRouteId } from '@/utils/routeParams';

/**
 * Edit product: GET /api/v1/admin/products/{id}, then the form. A background
 * refetch never unmounts the form (only a first load without data shows the
 * loading / error state), so typed input is never reset.
 */
export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = parseRouteId(id);
  const query = useAdminProduct(productId);

  if (query.data) return <ProductFormScreen product={query.data} />;

  const error = productId === null ? new ApiError('This product does not exist.', { status: 404, kind: 'http' }) : query.error;

  return (
    <RecordLoadState
      title="Edit product"
      error={error}
      onRetry={() => void query.refetch()}
      onBack={() => goBackOr(ROUTES.menuProducts)}
      testID="product-load-state"
    />
  );
}
