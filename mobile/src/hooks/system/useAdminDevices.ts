import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useState } from 'react';

import { useCursorList } from '@/hooks/useCursorList';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { getAdminDevice, listAdminDevices, renameDevice, restoreDevice, retireDevice } from '@/services/adminDevices';
import { ApiError, getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import type { AdminDevice, CursorPage, DevicePlatform } from '@/services/types';

export const DEVICE_SEARCH_DEBOUNCE_MS = 300;
/** Contract: `name` max 60. */
export const DEVICE_NAME_MAX = 60;

export type DevicePlatformFilter = 'all' | DevicePlatform;
export type DeviceStatusFilter = 'active' | 'retired' | 'all';

export const deviceKeys = {
  all: ['admin-devices'] as const,
  lists: () => [...deviceKeys.all, 'list'] as const,
  list: (filters: { search: string; platform: DevicePlatformFilter; status: DeviceStatusFilter }) =>
    [...deviceKeys.lists(), filters] as const,
  detail: (id: number) => [...deviceKeys.all, 'detail', id] as const,
};

/** Devices list (`system.manage`): search, platform filter (Tablets / Web terminals), status (default active). */
export function useDeviceListScreen() {
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState<DevicePlatformFilter>('all');
  const [status, setStatus] = useState<DeviceStatusFilter>('active');
  const debounced = useDebouncedValue(search.trim(), DEVICE_SEARCH_DEBOUNCE_MS);

  const list = useCursorList<AdminDevice>({
    queryKey: deviceKeys.list({ search: debounced, platform, status }),
    fetchPage: (cursor) =>
      listAdminDevices({ cursor, search: debounced || undefined, platform: platform === 'all' ? undefined : platform, status }),
    keepPrevious: true,
  });

  return {
    search,
    setSearch,
    searching: search.trim() !== debounced || list.grid.updating,
    platform,
    setPlatform,
    status,
    setStatus,
    filtersActive: debounced !== '' || platform !== 'all' || status !== 'active',
    clearFilters: () => {
      setSearch('');
      setPlatform('all');
      setStatus('active');
    },
    list,
  };
}

/** The device from any loaded list page: seeds the detail so it opens instantly. */
function findInLists(client: ReturnType<typeof useQueryClient>, id: number): AdminDevice | undefined {
  for (const [, data] of client.getQueriesData<InfiniteData<CursorPage<AdminDevice>>>({ queryKey: deviceKeys.lists() })) {
    for (const page of data?.pages ?? []) {
      const found = page.data.find((device) => device.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Opening a device from the list: caches it under its detail key so the detail shows at once. */
export function useRememberDevice() {
  const client = useQueryClient();
  return (device: AdminDevice) => client.setQueryData(deviceKeys.detail(device.id), device);
}

export const DEVICE_NOT_FOUND_MESSAGE = 'This device was not found.';

/**
 * One device for the detail screen: `GET /api/v1/admin/devices/{id}`, seeded
 * from the Devices list cache (`initialData`), so it opens instantly and then
 * refreshes. A 404 becomes "This device was not found.".
 */
export function useAdminDevice(id: number | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: deviceKeys.detail(id ?? -1),
    queryFn: async () => {
      try {
        return await getAdminDevice(id as number);
      } catch (error) {
        if (isApiError(error) && error.status === 404) throw new ApiError(DEVICE_NOT_FOUND_MESSAGE, { status: 404, kind: 'http' });
        throw error;
      }
    },
    initialData: () => (id === null ? undefined : findInLists(client, id)),
    initialDataUpdatedAt: 0,
    enabled: id !== null,
    retry: (count, error) => !(isApiError(error) && (error.status === 404 || error.status === 403)) && count < 2,
  });
}

/**
 * Rename, retire (with the 409 "still has N unsynced sales" confirm step) and
 * restore. Each answer replaces the cached device and refreshes the lists.
 */
export function useDeviceActions(device: AdminDevice | null) {
  const client = useQueryClient();
  const [busy, setBusy] = useState<'rename' | 'retire' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState('');
  const [retireOpen, setRetireOpen] = useState(false);
  /** The server's 409 message: retiring again with `confirm: true` goes ahead anyway. */
  const [unsyncedWarning, setUnsyncedWarning] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  function saved(next: AdminDevice) {
    client.setQueryData(deviceKeys.detail(next.id), next);
    void client.invalidateQueries({ queryKey: deviceKeys.lists() });
  }

  async function run(kind: 'rename' | 'retire' | 'restore', action: () => Promise<AdminDevice>): Promise<boolean> {
    setBusy(kind);
    setError(null);
    setNameError(null);
    try {
      saved(await action());
      return true;
    } catch (caught) {
      if (kind === 'retire' && isApiError(caught) && caught.status === 409 && unsyncedWarning === null) {
        setUnsyncedWarning(caught.message);
      } else if (isApiValidationError(caught)) {
        setNameError(caught.firstError('name'));
        if (!caught.firstError('name')) setError(caught.message);
      } else {
        setError(getErrorMessage(caught));
      }
      return false;
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    error,
    nameError,
    renameOpen,
    name,
    setName: (value: string) => {
      setName(value);
      setNameError(null);
    },
    openRename: () => {
      setName(device?.name ?? '');
      setError(null);
      setNameError(null);
      setRenameOpen(true);
    },
    closeRename: () => setRenameOpen(false),
    submitRename: async () => {
      if (!device || busy) return;
      if (await run('rename', () => renameDevice(device.id, { name: name.trim() }))) setRenameOpen(false);
    },
    retireOpen,
    unsyncedWarning,
    openRetire: () => {
      setError(null);
      setUnsyncedWarning(null);
      setRetireOpen(true);
    },
    closeRetire: () => {
      setRetireOpen(false);
      setUnsyncedWarning(null);
    },
    submitRetire: async () => {
      if (!device || busy) return;
      const confirm = unsyncedWarning !== null;
      if (await run('retire', () => retireDevice(device.id, confirm ? { confirm: true } : {}))) {
        setRetireOpen(false);
        setUnsyncedWarning(null);
      }
    },
    restoreOpen,
    openRestore: () => {
      setError(null);
      setRestoreOpen(true);
    },
    closeRestore: () => setRestoreOpen(false),
    submitRestore: async () => {
      if (!device || busy) return;
      if (await run('restore', () => restoreDevice(device.id))) setRestoreOpen(false);
    },
  };
}
