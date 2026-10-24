import { useLocalSearchParams } from 'expo-router';

import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { DeviceDetailScreen } from '@/components/system/DeviceDetailScreen';
import { ROUTES } from '@/constants/routes';
import { DEVICE_NOT_FOUND_MESSAGE, useAdminDevice } from '@/hooks/system/useAdminDevices';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { parseRouteId } from '@/utils/routeParams';

/**
 * One device (`system.manage`): GET /api/v1/admin/devices/{id}, seeded from the
 * Devices list so it opens at once. 404 → "This device was not found." with Back.
 */
export default function DeviceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const deviceId = parseRouteId(id);
  const query = useAdminDevice(deviceId);

  if (query.data) return <DeviceDetailScreen device={query.data} />;

  const error = deviceId === null ? new ApiError(DEVICE_NOT_FOUND_MESSAGE, { status: 404, kind: 'http' }) : query.error;
  return (
    <RecordLoadState
      title="Device"
      error={error}
      onRetry={() => void query.refetch()}
      onBack={() => goBackOr(ROUTES.devices)}
      testID="device-load-state"
    />
  );
}
