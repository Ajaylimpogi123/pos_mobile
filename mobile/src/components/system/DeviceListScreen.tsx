import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HealthChip } from '@/components/device/DeviceParts';
import { CardGrid, type GridEmptyProps, type GridTable } from '@/components/shared/CardGrid';
import { ChipFilterRow } from '@/components/shared/ChipFilterRow';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { DeviceCard, lastSeenLabel } from '@/components/system/DeviceCard';
import { Chip } from '@/components/ui/Chip';
import { CellText } from '@/components/ui/DataTable';
import { Screen } from '@/components/ui/Screen';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { deviceRoute } from '@/constants/routes';
import { spacing } from '@/constants/theme';
import {
  useDeviceListScreen,
  useRememberDevice,
  type DevicePlatformFilter,
  type DeviceStatusFilter,
} from '@/hooks/system/useAdminDevices';
import type { AdminDevice } from '@/services/types';
import { DEVICE_HEALTH_LABELS, DEVICE_PLATFORM_LABELS, DEVICE_PLATFORM_NAMES, unsyncedSalesLabel } from '@pos/core/errors/health';

const PLATFORMS: readonly SegmentOption<DevicePlatformFilter>[] = [
  { value: 'all', label: 'All', testID: 'devices-platform-all' },
  { value: 'android', label: DEVICE_PLATFORM_LABELS.android, testID: 'devices-platform-android' },
  { value: 'web', label: DEVICE_PLATFORM_LABELS.web, testID: 'devices-platform-web' },
];

const STATUSES: readonly { value: DeviceStatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'retired', label: 'Retired' },
  { value: 'all', label: 'All' },
];

function keyOf(device: AdminDevice): string {
  return String(device.id);
}

function rowTestID(device: AdminDevice): string {
  return `device-card-${device.id}`;
}

/** The table (tablets in landscape): code and name, platform and version, health, unsynced sales, last seen. Test IDs match the card's. */
function useDeviceTable(open: (device: AdminDevice) => void): GridTable<AdminDevice> {
  return useMemo(
    () => ({
      columns: [
        {
          key: 'device',
          header: 'Device',
          flex: 1.5,
          render: (device) => (
            <View style={styles.cellStack}>
              <CellText variant="strong">{device.code}</CellText>
              <CellText variant="muted">{device.name}</CellText>
            </View>
          ),
        },
        {
          key: 'platform',
          header: 'Platform',
          render: (device) => (
            <CellText>
              {DEVICE_PLATFORM_NAMES[device.platform]}
              {device.app_version ? ` · v${device.app_version}` : ''}
            </CellText>
          ),
        },
        { key: 'health', header: 'Health', render: (device) => <HealthChip health={device.health} testID={`${rowTestID(device)}-health`} /> },
        {
          key: 'unsynced',
          header: 'Unsynced',
          render: (device) => {
            const unsynced = unsyncedSalesLabel(device.heartbeat?.outbox_pending);
            return unsynced ? <Chip label={unsynced} variant="warning" testID={`${rowTestID(device)}-unsynced`} /> : <CellText variant="muted">—</CellText>;
          },
        },
        { key: 'seen', header: 'Last seen', render: (device) => <CellText variant="muted">{lastSeenLabel(device)}</CellText> },
      ],
      onRowPress: open,
      rowAccessibilityLabel: (device) =>
        [
          `${device.code}, ${device.name}`,
          DEVICE_PLATFORM_NAMES[device.platform],
          DEVICE_HEALTH_LABELS[device.health],
          unsyncedSalesLabel(device.heartbeat?.outbox_pending),
          lastSeenLabel(device),
        ]
          .filter(Boolean)
          .join(', '),
      rowAccessibilityHint: 'Opens the device',
      rowTestID,
    }),
    [open],
  );
}

/**
 * Admin Devices (Hardening & Pilot §E, `system.manage`): every tablet and web
 * terminal of the branch with a health badge and the unsynced count, on the
 * band; platform filter (Tablets / Web terminals), status and search in a
 * white card; the table in landscape and the cards in portrait (MASTER §6);
 * every list state and the "Showing n" footer.
 */
export function DeviceListScreen() {
  const screen = useDeviceListScreen();
  const remember = useRememberDevice();

  const open = useMemo(
    () => (device: AdminDevice) => {
      remember(device);
      router.push(deviceRoute(device.id));
    },
    [remember],
  );
  const table = useDeviceTable(open);

  const empty: GridEmptyProps = screen.filtersActive
    ? { title: 'No matching devices', message: 'Try another filter or search.', icon: 'search-outline', actionLabel: 'Clear filters', onAction: screen.clearFilters }
    : { title: 'No devices yet', message: 'Tablets and web terminals appear here after their first sign-in.', icon: 'hardware-chip-outline' };

  return (
    <Screen edges={[]} testID="device-list-screen">
      <ListHeader band title="Devices" subtitle="Tablets and web terminals" testIDPrefix="devices" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="devices-toolbar">
        <ListFilters<DevicePlatformFilter>
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="Code or name"
          searchTestID="devices-search"
          segment={{ options: PLATFORMS, value: screen.platform, onChange: screen.setPlatform, accessibilityLabel: 'Platform', testID: 'devices-platform' }}
        />
        <ChipFilterRow<DeviceStatusFilter>
          options={STATUSES}
          value={screen.status}
          onChange={screen.setStatus}
          accessibilityLabel="Status"
          testIDPrefix="devices-status"
        />
        </ListToolbar>
        <CardGrid
          items={screen.list.items}
          keyOf={keyOf}
          renderItem={(device) => <DeviceCard device={device} onPress={open} />}
          {...screen.list.grid}
          empty={empty}
          table={table}
          testID="devices-grid"
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  cellStack: {
    gap: spacing.xxs,
    maxWidth: '100%',
  },
});
