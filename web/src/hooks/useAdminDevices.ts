/**
 * Admin devices (Hardening & Pilot §C/§E), `system.manage`: the cursor list
 * with its filters, and rename / retire (with the 409 unsynced-sales confirm) / restore.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { listAdminDevices, renameAdminDevice, restoreAdminDevice, retireAdminDevice } from '@/services/adminDevices';
import type { AdminDevice, AdminDeviceQuery, DevicePlatform } from '@/services/types';

export type DeviceStatusFilter = NonNullable<AdminDeviceQuery['status']>;

export type DeviceFilters = {
  status: DeviceStatusFilter;
  platform: DevicePlatform | null;
  search: string;
};

export const DEVICE_NAME_MAX = 60;

export const adminDeviceKeys = {
  all: ['admin-devices'] as const,
  list: (filters: DeviceFilters) => ['admin-devices', 'list', filters] as const,
};

export function useAdminDeviceList(filters: DeviceFilters) {
  return useCursorList(adminDeviceKeys.list(filters), (cursor) =>
    listAdminDevices({
      cursor,
      per_page: 25,
      status: filters.status,
      platform: filters.platform ?? undefined,
      search: filters.search || undefined,
    }),
  );
}

function useDeviceMutation<V>(run: (vars: V) => Promise<AdminDevice>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => void client.invalidateQueries({ queryKey: adminDeviceKeys.all }),
  });
}

export function useRenameDevice() {
  return useDeviceMutation(({ id, name }: { id: number; name: string }) => renameAdminDevice(id, { name }));
}

/** `confirm: true` retires even with unsynced sales (after the 409). */
export function useRetireDevice() {
  return useDeviceMutation(({ id, confirm }: { id: number; confirm: boolean }) => retireAdminDevice(id, confirm ? { confirm: true } : {}));
}

export function useRestoreDevice() {
  return useDeviceMutation((id: number) => restoreAdminDevice(id));
}
