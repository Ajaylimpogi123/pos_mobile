import { useLocalSearchParams } from 'expo-router';

import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { ErrorGroupDetailScreen } from '@/components/system/ErrorGroupDetailScreen';
import { ROUTES } from '@/constants/routes';
import { useErrorGroup } from '@/hooks/system/useErrorLog';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { parseRouteId } from '@/utils/routeParams';

/** One error group: GET /api/v1/admin/error-log/{group}, with resolve / reopen. */
export default function ErrorGroupRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = parseRouteId(id);
  const group = useErrorGroup(groupId);

  if (group.query.data) {
    return (
      <ErrorGroupDetailScreen
        group={group.query.data}
        toggling={group.toggling}
        actionError={group.actionError}
        onResolve={group.resolve}
        onReopen={group.reopen}
      />
    );
  }

  const error = groupId === null ? new ApiError('This error does not exist.', { status: 404, kind: 'http' }) : group.query.error;
  return (
    <RecordLoadState
      title="Error"
      error={error}
      onRetry={() => void group.query.refetch()}
      onBack={() => goBackOr(ROUTES.errorLog)}
      testID="error-group-load-state"
    />
  );
}
