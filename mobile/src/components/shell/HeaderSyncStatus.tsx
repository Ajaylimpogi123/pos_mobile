import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Chip, STATUS_CHIP_HIT_SLOP, type ChipVariant } from '@/components/ui/Chip';
import { ROUTES } from '@/constants/routes';
import { opacity, radius } from '@/constants/theme';
import { useSyncState, type SyncState } from '@/hooks/sync/useSyncState';
import { useResponsive } from '@/hooks/useResponsive';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

export type HeaderSyncLook = {
  /** "Online" / "Offline": the short form (phones). */
  short: string;
  /** "Online · synced", "Offline · 3 pending", …: the full form. */
  label: string;
  variant: ChipVariant;
};

/**
 * The header's sync state (MASTER §2.2): a dot plus "Online · synced",
 * "Offline · 3 pending" and so on. One state shows, by priority: offline (the
 * device, or a server that doesn't answer), syncing, sales that need
 * attention, sales still to send, a failed menu sync, then synced.
 */
export function describeHeaderSync(sync: SyncState): HeaderSyncLook {
  const pending = sync.pending > 0 ? ` · ${sync.pending} pending` : '';
  if (!sync.online || sync.status === 'offline') {
    return { short: 'Offline', label: `Offline${pending}`, variant: 'cancelled' };
  }
  if (!sync.serverReachable) {
    return { short: 'Offline', label: `Offline · server not reachable${pending}`, variant: 'cancelled' };
  }
  if (sync.status === 'syncing' || sync.outboxSyncing) {
    return { short: 'Syncing', label: 'Online · syncing…', variant: 'processing' };
  }
  if (sync.needsAttention > 0) {
    return { short: 'Online', label: `Online · ${sync.needsAttention} need attention`, variant: 'cancelled' };
  }
  if (sync.pending > 0) {
    return { short: 'Online', label: `Online${pending}`, variant: 'pending' };
  }
  if (sync.status === 'error') {
    return { short: 'Online', label: 'Online · sync failed', variant: 'cancelled' };
  }
  if (!sync.syncedLabel) return { short: 'Online', label: 'Online · not synced yet', variant: 'neutral' };
  return { short: 'Online', label: 'Online · synced', variant: 'completed' };
}

/**
 * The always-visible sync badge in the header of every app-shell screen.
 * Users who sell can tap it to open the Sync queue. Phones in portrait show
 * the short word ("Online" / "Offline"); the full state stays the
 * accessibility label.
 */
export function HeaderSyncStatus() {
  const sync = useSyncState();
  const { statusChipLabels } = useResponsive();
  const canSell = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));
  const look = describeHeaderSync(sync);
  const label = `Sync status: ${look.label}`;

  const chip = (
    <Chip
      label={statusChipLabels ? look.label : look.short}
      variant={look.variant}
      size="bar"
      accessibilityLabel={canSell ? undefined : label}
      testID="header-sync-status"
    />
  );
  if (!canSell) return chip;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the sync queue"
      onPress={() => router.push(ROUTES.syncQueue)}
      hitSlop={STATUS_CHIP_HIT_SLOP}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      testID="header-sync-status-open"
    >
      {chip}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: radius.sm,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
