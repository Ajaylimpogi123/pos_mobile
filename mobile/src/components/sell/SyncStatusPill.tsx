import { Pressable, StyleSheet } from 'react-native';

import { Chip, STATUS_CHIP_HIT_SLOP, type ChipVariant } from '@/components/ui/Chip';
import type { IconName } from '@/components/ui/Icon';
import { opacity, pressedScale, radius } from '@/constants/theme';
import type { SellSyncState } from '@/hooks/sell/useSellScreen';

type SyncStatusPillProps = {
  sync: SellSyncState;
  /** Opens the Sync queue. Without it the pill is read-only (e.g. no `sale.create`). */
  onPress?: () => void;
  /** Phones in portrait: the icon only (the label stays the accessibility label). */
  iconOnly?: boolean;
};

type PillLook = { label: string; variant: ChipVariant; icon: IconName };

/** The Offline pill's hint when the device is connected but the server doesn't answer. */
export const SERVER_UNREACHABLE_HINT = "Can't reach the server";

/**
 * The label, colour and glyph of the unified sync status
 * (docs/api-contract.md → Offline Sales → Status pill, building on Catalogue
 * Sync → Sync status). One state shows, by priority:
 * 1. `Offline`: no connection (the menu and the sales can't sync), or, with the hint
 *    "Can't reach the server", a connection on which the server doesn't answer
 * 2. `Syncing…`: the menu or the offline sales are syncing
 * 3. `Needs attention (N)`: sales the server rejected (kept, with Retry)
 * 4. `Pending (N)`: sales saved on this tablet, still to send
 * 5. `Sync failed`: the last menu sync failed
 * 6. `Synced N min ago` (or `Not synced yet` before the first menu sync)
 */
export function describeSyncStatus(sync: SellSyncState): PillLook {
  if (!sync.online || sync.status === 'offline') {
    return { label: 'Offline', variant: 'cancelled', icon: 'cloud-offline-outline' };
  }
  if (!sync.serverReachable) {
    return { label: `Offline · ${SERVER_UNREACHABLE_HINT}`, variant: 'cancelled', icon: 'cloud-offline-outline' };
  }
  if (sync.status === 'syncing' || sync.outboxSyncing) {
    return { label: 'Syncing…', variant: 'processing', icon: 'sync' };
  }
  if (sync.needsAttention > 0) {
    return { label: `Needs attention (${sync.needsAttention})`, variant: 'cancelled', icon: 'alert-circle-outline' };
  }
  if (sync.pending > 0) {
    return { label: `Pending (${sync.pending})`, variant: 'pending', icon: 'cloud-upload-outline' };
  }
  if (sync.status === 'error') {
    return { label: 'Sync failed', variant: 'cancelled', icon: 'alert-circle-outline' };
  }
  // `synced`, or `idle` before this launch's first run: show the last stored sync time.
  return sync.syncedLabel
    ? { label: sync.syncedLabel, variant: 'completed', icon: 'checkmark-circle-outline' }
    : { label: 'Not synced yet', variant: 'neutral', icon: 'cloud-download-outline' };
}

/**
 * The sync status chip in the Sell top bar: `Synced` · `Pending (N)` ·
 * `Syncing` · `Needs attention (N)` · `Offline` (plus the menu's own
 * "Sync failed"). Tapping it opens the Sync queue.
 */
export function SyncStatusPill({ sync, onPress, iconOnly = false }: SyncStatusPillProps) {
  const look = describeSyncStatus(sync);
  const chip = (
    <Chip label={look.label} variant={look.variant} icon={look.icon} size="bar" iconOnly={iconOnly} testID="sync-status" />
  );
  if (!onPress) return chip;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${look.label}`}
      accessibilityHint="Opens the sync queue"
      onPress={onPress}
      hitSlop={STATUS_CHIP_HIT_SLOP}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      testID="sync-status-open"
    >
      {chip}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: opacity.dimmed,
    transform: [{ scale: pressedScale }],
  },
});
