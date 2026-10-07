import { useLocalSearchParams } from 'expo-router';

import { CategoryFormScreen } from '@/components/menu/CategoryFormScreen';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { ROUTES } from '@/constants/routes';
import { useAdminCategory } from '@/hooks/menu/useAdminCategories';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { parseRouteId } from '@/utils/routeParams';

/** Edit category: GET /api/v1/admin/categories/{id}, then the form. */
export default function EditCategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const categoryId = parseRouteId(id);
  const query = useAdminCategory(categoryId);

  if (query.data) return <CategoryFormScreen category={query.data} />;

  const error =
    categoryId === null ? new ApiError('This category does not exist.', { status: 404, kind: 'http' }) : query.error;

  return (
    <RecordLoadState
      title="Edit category"
      error={error}
      onRetry={() => void query.refetch()}
      onBack={() => goBackOr(ROUTES.menuCategories)}
      testID="category-load-state"
    />
  );
}
