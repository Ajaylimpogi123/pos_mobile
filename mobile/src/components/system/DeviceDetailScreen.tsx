import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionRow, HealthChip, ValueRow } from '@/components/device/DeviceParts';
import { InfoCard } from '@/components/shared/InfoCard';
import { ListHeader } from '@/components/shared/ListHeader';
import { lastSeenLabel } from '@/components/system/DeviceCard';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { colors, spacing, typography } from '@/constants/theme';
import { DEVICE_NAME_MAX, useDeviceActions } from '@/hooks/system/useAdminDevices';
import { useNow } from '@/hooks/useNow';
import { useResponsive } from '@/hooks/useResponsive';
import type { AdminDevice } from '@/services/types';
import { formatRelativeTime } from '@/utils/dates';
import { DEVICE_HEALTH_DESCRIPTIONS, DEVICE_PLATFORM_NAMES } from '@pos/core/errors/health';

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value);
}

function when(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  return formatRelativeTime(iso, now) ?? '—';
}

/**
 * One device (admin Devices, `system.manage`): its health and every heartbeat
 * field, then Rename, Retire (the server's 409 "still has N unsynced sales"
 * becomes a second, explicit confirmation) and Restore.
 */
export function DeviceDetailScreen({ device }: { device: AdminDevice }) {
  const now = useNow(30_000);
  const actions = useDeviceActions(device);
  const { screenPaddingX, screenPaddingY, formMaxWidth, gutter } = useResponsive();
  const beat = device.heartbeat;
  const isWeb = device.platform === 'web';

  return (
    <Screen edges={[]} testID="device-detail-screen">
      <ListHeader title={`${device.code} · ${device.name}`} subtitle={DEVICE_PLATFORM_NAMES[device.platform]} testIDPrefix="device-detail" />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.body}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY, maxWidth: formMaxWidth * 2, gap: gutter },
          ]}
        >
          {actions.error && !actions.renameOpen && !actions.retireOpen && !actions.restoreOpen ? (
            <Banner message={actions.error} testID="device-detail-error" />
          ) : null}

          <InfoCard title="Status" icon="pulse-outline" tone={device.health === 'ok' ? 'primary' : 'danger'} testID="device-detail-status">
            <View style={styles.statusRow}>
              <HealthChip health={device.health} testID="device-detail-health" />
              <Text style={styles.muted}>{DEVICE_HEALTH_DESCRIPTIONS[device.health]}</Text>
            </View>
            <ValueRow label="Last seen" value={lastSeenLabel(device, now)} testID="device-detail-last-seen" />
            <ValueRow label="Last heartbeat" value={when(device.heartbeat_at, now)} />
            <ValueRow label="App version" value={device.app_version ?? '—'} testID="device-detail-version" />
            <ValueRow label="Last user" value={device.last_user?.name ?? '—'} />
            {device.retired_at ? <ValueRow label="Retired" value={when(device.retired_at, now)} testID="device-detail-retired" /> : null}
          </InfoCard>

          <InfoCard title="Last heartbeat" icon="heart-outline" tone="info" testID="device-detail-heartbeat">
            {beat === null ? (
              <Text style={styles.muted}>No heartbeat received yet.</Text>
            ) : (
              <>
                {isWeb ? null : (
                  <>
                    <ValueRow label="Sales to send" value={count(beat.outbox_pending)} testID="device-detail-pending" />
                    <ValueRow label="Failed sales" value={count(beat.outbox_failed)} testID="device-detail-failed" />
                    <ValueRow label="Oldest waiting" value={when(beat.oldest_pending_at, now)} />
                    <ValueRow label="Menu synced" value={when(beat.last_catalogue_sync_at, now)} />
                    <ValueRow label="Stock synced" value={when(beat.last_stock_sync_at, now)} />
                    <ValueRow label="Free storage" value={beat.storage_free_mb === null ? '—' : `${beat.storage_free_mb.toLocaleString('en-US')} MB`} />
                  </>
                )}
                <ValueRow label="Error reports waiting" value={count(beat.errors_pending)} />
                <ValueRow label="System" value={[beat.os_version, beat.device_model].filter(Boolean).join(' · ') || '—'} />
                {beat.printers.length === 0 ? (
                  <ValueRow label="Printers" value="—" />
                ) : (
                  beat.printers.map((printer) => (
                    <ValueRow
                      key={printer.id}
                      label={`Printer #${printer.id}`}
                      value={`${printer.ok ? 'OK' : 'Not responding'} · ${when(printer.checked_at, now)}`}
                      testID={`device-detail-printer-${printer.id}`}
                    />
                  ))
                )}
              </>
            )}
          </InfoCard>

          <InfoCard title="Manage" icon="construct-outline" testID="device-detail-manage">
            <ActionRow>
              <Button title="Rename" leftIcon="create-outline" variant="secondary" onPress={actions.openRename} testID="device-rename" />
              {device.is_active ? (
                <Button title="Retire" leftIcon="archive-outline" variant="danger" onPress={actions.openRetire} testID="device-retire" />
              ) : (
                <Button title="Restore" leftIcon="refresh" onPress={actions.openRestore} testID="device-restore" />
              )}
            </ActionRow>
            <Text style={styles.muted}>
              {device.is_active
                ? 'Retiring signs out whoever is using it. It can be restored later.'
                : 'Restoring lets staff sign in on it again.'}
            </Text>
          </InfoCard>
        </ScrollView>
      </SafeAreaView>

      <ConfirmDialog
        visible={actions.renameOpen}
        title="Rename device"
        confirmLabel="Save"
        icon="create-outline"
        busy={actions.busy === 'rename'}
        confirmDisabled={actions.name.trim() === ''}
        error={actions.error}
        onConfirm={() => void actions.submitRename()}
        onCancel={actions.closeRename}
        testID="device-rename-dialog"
      >
        <Input
          label="Name"
          value={actions.name}
          onChangeText={actions.setName}
          error={actions.nameError}
          maxLength={DEVICE_NAME_MAX}
          editable={actions.busy !== 'rename'}
          autoFocus
          testID="device-rename-input"
        />
      </ConfirmDialog>

      <ConfirmDialog
        visible={actions.retireOpen}
        title={actions.unsyncedWarning ? 'Retire anyway?' : `Retire ${device.code}?`}
        message={
          actions.unsyncedWarning ??
          `${device.code} will be signed out and can't be used until it is restored.`
        }
        confirmLabel={actions.unsyncedWarning ? 'Retire anyway' : 'Retire'}
        confirmVariant="danger"
        icon="archive-outline"
        busy={actions.busy === 'retire'}
        error={actions.error}
        onConfirm={() => void actions.submitRetire()}
        onCancel={actions.closeRetire}
        testID="device-retire-dialog"
      />

      <ConfirmDialog
        visible={actions.restoreOpen}
        title={`Restore ${device.code}?`}
        message="Staff can sign in on it again."
        confirmLabel="Restore"
        icon="refresh"
        busy={actions.busy === 'restore'}
        error={actions.error}
        onConfirm={() => void actions.submitRestore()}
        onCancel={actions.closeRestore}
        testID="device-restore-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
  statusRow: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  muted: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
