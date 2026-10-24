import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HealthChip } from '@/components/device/DeviceParts';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { IconBadge } from '@/components/ui/IconBadge';
import { colors, pressedScale, spacing, typography } from '@/constants/theme';
import type { AdminDevice } from '@/services/types';
import { formatRelativeTime } from '@/utils/dates';
import { DEVICE_HEALTH_LABELS, DEVICE_PLATFORM_NAMES, unsyncedSalesLabel } from '@pos/core/errors/health';

export function lastSeenLabel(device: AdminDevice, now: number = Date.now()): string {
  if (!device.last_seen_at) return 'Never seen';
  return `Seen ${(formatRelativeTime(device.last_seen_at, now) ?? 'unknown').toLowerCase()}`;
}

/** A device: code and name, platform, health chip, unsynced sales, last seen. Tap to open. */
export const DeviceCard = memo(function DeviceCard({ device, onPress }: { device: AdminDevice; onPress: (device: AdminDevice) => void }) {
  const testID = `device-card-${device.id}`;
  const unsynced = unsyncedSalesLabel(device.heartbeat?.outbox_pending);
  const spoken = [
    `${device.code}, ${device.name}`,
    DEVICE_PLATFORM_NAMES[device.platform],
    DEVICE_HEALTH_LABELS[device.health],
    unsynced,
    lastSeenLabel(device),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Opens the device"
        onPress={() => onPress(device)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.titleRow}>
          <IconBadge icon={device.platform === 'web' ? 'desktop-outline' : 'tablet-landscape-outline'} tone={device.health === 'ok' ? 'primary' : device.health === 'retired' ? 'info' : 'danger'} />
          <View style={styles.titleText}>
            <Text style={styles.code} numberOfLines={1}>
              {device.code}
            </Text>
            <Text style={styles.name} numberOfLines={2}>
              {device.name}
            </Text>
          </View>
          <HealthChip health={device.health} testID={`${testID}-health`} />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{DEVICE_PLATFORM_NAMES[device.platform]}</Text>
          {device.app_version ? <Text style={styles.meta}>v{device.app_version}</Text> : null}
          <Text style={styles.meta}>{lastSeenLabel(device)}</Text>
        </View>
        {unsynced ? <Chip label={unsynced} variant="warning" size="sm" testID={`${testID}-unsynced`} /> : null}
      </Pressable>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
  },
  body: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  titleRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  titleText: {
    flex: 1,
  },
  code: {
    ...typography.label,
    color: colors.textSecondary,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  meta: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
