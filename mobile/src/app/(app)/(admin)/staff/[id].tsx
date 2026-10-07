import { useLocalSearchParams } from 'expo-router';

import { StaffEditScreen } from '@/components/staff/StaffEditScreen';
import { StaffReadOnlyScreen } from '@/components/staff/StaffReadOnlyScreen';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { ROUTES } from '@/constants/routes';
import { useStaffMember } from '@/hooks/staff/useStaff';
import { ApiError } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { goBackOr } from '@/utils/navigation';
import { parseRouteId } from '@/utils/routeParams';

/**
 * One staff member: GET /api/v1/admin/users/{id}, then the edit screen when
 * the caller may manage them (`can_manage`), else a read-only view. A
 * background refetch never unmounts the form, so typed input is never reset.
 */
export default function StaffMemberRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const staffId = parseRouteId(id);
  const query = useStaffMember(staffId);
  const selfId = useSessionStore((state) => state.user?.id ?? null);

  if (query.data) {
    return query.data.can_manage ? (
      <StaffEditScreen staff={query.data} isSelf={query.data.id === selfId} />
    ) : (
      <StaffReadOnlyScreen staff={query.data} />
    );
  }

  const error = staffId === null ? new ApiError('This staff member does not exist.', { status: 404, kind: 'http' }) : query.error;

  return (
    <RecordLoadState
      title="Staff"
      error={error}
      onRetry={() => void query.refetch()}
      onBack={() => goBackOr(ROUTES.staff)}
      testID="staff-load-state"
    />
  );
}
