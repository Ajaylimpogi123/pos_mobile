import { router } from 'expo-router';
import { Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrinterStatusPill } from '@/components/printing/PrinterStatusPill';
import { SyncStatusPill } from '@/components/sell/SyncStatusPill';
import { SEARCH_MAX_LENGTH } from '@/components/shared/ListFilters';
import { ShiftPill } from '@/components/shifts/ShiftPill';
import { MenuButton } from '@/components/shell/MenuButton';
import { HeaderBand } from '@/components/ui/HeaderBand';
import { IconButton } from '@/components/ui/IconButton';
import { SearchGroup } from '@/components/ui/SearchGroup';
import { ROUTES } from '@/constants/routes';
import { colors, hitTarget, layout, sizes, spacing, typography } from '@/constants/theme';
import type { LocalShift } from '@/db/shiftRepository';
import type { SellSyncState } from '@/hooks/sell/useSellScreen';
import { useResponsive } from '@/hooks/useResponsive';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

export type SellSearch = {
  value: string;
  onChange: (text: string) => void;
  /** The debounced search is still catching up with the typed text. */
  searching: boolean;
};

type SellHeaderProps = {
  sync: SellSyncState;
  onSyncNow: () => void;
  /** Phase 6: this tablet's open shift (`null`: none, or a read-only user). */
  shift?: LocalShift | null;
  onOpenShiftMenu?: () => void;
  /** The menu search (only once there is a menu to search). */
  search?: SellSearch | null;
};

/** Vertical room around the header status badges so their 48 touch areas stay inside the scroll view. */
const STATUS_PAD_Y = (hitTarget.primary - sizes.statusChipHeight) / 2;

/**
 * The Sell screen's header (sell.md, MASTER §2.2 / §2.3):
 * - the 48 dp header row (56 on phones): [☰] "POS", then the status badges
 *   (shift, sync, printers; icon-only on phones in portrait, the label stays
 *   the accessibility label) and a "Sync now" icon button. The badges scroll
 *   sideways inside the row rather than wrapping.
 * - once there is a menu to search: the decorative green band with the white
 *   "Search" label and the search group (input + **Search** button). Search
 *   still filters as you type; the button and the keyboard key just close the
 *   keyboard. The category tiles and the product grid drawn after the header
 *   overlap the band.
 * The search keeps its tree position in every layout, so rotating keeps the
 * typed text and the focus.
 * Offline Sales (Phase 5): the sync badge is the unified status; with
 * `sale.create`, tapping it opens the Sync queue. Shifts (Phase 6): the shift
 * badge opens the shift menu.
 */
export function SellHeader({ sync, onSyncNow, shift = null, onOpenShiftMenu, search = null }: SellHeaderProps) {
  const { statusChipLabels, screenPaddingX, topBarHeight } = useResponsive();
  const canSell = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));
  const iconOnly = !statusChipLabels;

  return (
    <View testID="sell-header">
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.bar}>
        <View style={[styles.row, { minHeight: topBarHeight, paddingHorizontal: screenPaddingX }]} testID="sell-header-bar">
          <MenuButton testID="sell-open-navigation" />
          <Text style={[styles.title, typography.barTitle]} numberOfLines={1} accessibilityRole="header" testID="sell-header-title">
            POS
          </Text>
          <View style={styles.statusGroup}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.statusScroll}
              contentContainerStyle={styles.status}
              testID="sell-status"
            >
              {shift && onOpenShiftMenu ? <ShiftPill shift={shift} onPress={onOpenShiftMenu} iconOnly={iconOnly} /> : null}
              <SyncStatusPill sync={sync} onPress={canSell ? () => router.push(ROUTES.syncQueue) : undefined} iconOnly={iconOnly} />
              <PrinterStatusPill iconOnly={iconOnly} />
            </ScrollView>
            <IconButton
              icon="sync"
              variant="soft"
              accessibilityLabel="Sync now"
              accessibilityHint="Downloads the latest menu and sends the sales saved on this device"
              onPress={onSyncNow}
              disabled={sync.syncing}
              testID="sell-sync-now"
            />
          </View>
        </View>
      </SafeAreaView>
      {search ? (
        <SafeAreaView edges={['left', 'right']}>
          <View style={[styles.band, { paddingHorizontal: screenPaddingX }]} testID="sell-band">
            <HeaderBand style={styles.bandShape} testID="sell-band-gradient" />
            <View style={styles.search}>
              <SearchGroup
                label="Search"
                onBand
                value={search.value}
                onChangeText={search.onChange}
                onSubmit={Keyboard.dismiss}
                onClear={() => search.onChange('')}
                busy={search.searching}
                placeholder="Search menu or SKU"
                maxLength={SEARCH_MAX_LENGTH}
                testID="sell-search-group"
                inputTestID="sell-search"
              />
            </View>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: {
    width: '100%',
    alignSelf: 'center',
    maxWidth: layout.contentMaxWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flexShrink: 0,
    minWidth: layout.barTitleMinWidth,
    color: colors.text,
  },
  statusGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  statusScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: STATUS_PAD_Y,
    paddingHorizontal: STATUS_PAD_Y,
  },
  band: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  /** Inset so the band's 6 px corners show. */
  bandShape: {
    left: spacing.sm,
    right: spacing.sm,
    top: spacing.sm,
  },
  search: {
    width: '100%',
    maxWidth: layout.searchMaxWidth,
  },
});
