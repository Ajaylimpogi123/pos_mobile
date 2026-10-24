import { DeviceListScreen } from '@/components/system/DeviceListScreen';

/** Admin Devices: GET /api/v1/admin/devices (`system.manage`). */
export default function DevicesIndexRoute() {
  return <DeviceListScreen />;
}
