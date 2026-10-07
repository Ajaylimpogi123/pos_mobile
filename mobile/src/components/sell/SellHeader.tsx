import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrinterStatusPill } from '@/components/printing/PrinterStatusPill';
import { SyncStatusPill } from '@/components/sell/SyncStatusPill';
import { SEARCH_MAX_LENGTH } from '@/components/shared/ListFilters';
import { ShiftPill } from '@/components/shifts/ShiftPill';
import { MenuButton } from '@/components/shell/MenuButton';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
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

/** Vertical room around the 36-high chips so their 44 touch areas stay inside the scroll view. */
const STATUS_PAD_Y = (hitTarget.min - sizes.statusChipHeight) / 2;

/**
 * The Sell screen's top bar (POS board): it sits on the page background, with a
 * white search field (hairline border).
 * - Tablets and landscape: one row: [☰] the 48 dp search, then the status
 *   chips (shift, sync, printers) with labels and a "Sync now" icon button.
 * - Phones in portrait: ☰, "Sell" and icon-only chips (the label stays the
 *   accessibility label); the search sits on a second line.
 * - Before the menu is synced there is no search: the title shows instead.
 * The search keeps its tree position in every layout (only the container's
 * direction changes), so rotating keeps the typed text and the focus. The
 * chips scroll sideways inside the bar rather than wrapping.
 * Offline Sales (Phase 5): the sync chip is the unified status; with
 * `sale.create`, tapping it opens the Sync queue. Shifts (Phase 6): the shift
 * chip opens the shift menu.
 */
export function SellHeader({ sync, onSyncNow, shift = null, onOpenShiftMenu, search = null }: SellHeaderProps) {
  const { statusChipLabels, screenPaddingX, topBarHeight, isTablet, isCompactHeight } = useResponsive();
  const canSell = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));
  const wide = statusChipLabels;
  const iconOnly = !statusChipLabels;
  const showTitle = !wide || search === null;

  const status = (
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
  );

  let searchAccessory = null;
  if (search?.searching) {
    searchAccessory = <ActivityIndicator color={colors.primaryBright} style={styles.accessory} />;
  } else if (search && search.value !== '') {
    searchAccessory = (
      <IconButton
        icon="close-circle"
        variant="ghost"
        accessibilityLabel="Clear search"
        onPress={() => search.onChange('')}
        testID="sell-search-clear"
      />
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.bar} testID="sell-header">
      <View
        style={[
          styles.inner,
          wide ? styles.innerRow : styles.innerColumn,
          { minHeight: topBarHeight, paddingHorizontal: screenPaddingX },
        ]}
        testID="sell-header-bar"
      >
        <View style={[styles.lead, wide && search === null && styles.leadFill, { minHeight: topBarHeight }]}>
          <MenuButton testID="sell-open-navigation" />
          {showTitle ? (
            <Text
              style={[styles.title, isTablet && !isCompactHeight ? typography.barTitleLarge : typography.barTitle]}
              numberOfLines={1}
              accessibilityRole="header"
              testID="sell-header-title"
            >
              Sell
            </Text>
          ) : null}
          {wide ? null : status}
        </View>
        {search ? (
          <View style={wide ? styles.searchWide : styles.searchStacked}>
            <Input
              label="Search"
              variant="searchSurface"
              value={search.value}
              onChangeText={search.onChange}
              placeholder="Search menu or SKU"
              leftIcon="search"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              maxLength={SEARCH_MAX_LENGTH}
              rightAccessory={searchAccessory}
              testID="sell-search"
            />
          </View>
        ) : null}
        {wide ? status : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
  },
  inner: {
    width: '100%',
    alignSelf: 'center',
    maxWidth: layout.contentMaxWidth,
  },
  innerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  innerColumn: {
    flexDirection: 'column',
    paddingBottom: spacing.md,
  },
  lead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  leadFill: {
    flex: 1,
  },
  title: {
    flex: 1,
    minWidth: layout.barTitleMinWidth,
    color: colors.text,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.xs,
  },
  statusScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    // 8 between 36-high chips: their 44 touch areas meet but never overlap.
    gap: spacing.sm,
    paddingVertical: STATUS_PAD_Y,
    paddingHorizontal: STATUS_PAD_Y,
  },
  searchWide: {
    flex: 1,
    minWidth: layout.searchMaxWidth / 2,
  },
  searchStacked: {
    width: '100%',
  },
  accessory: {
    marginHorizontal: spacing.md,
  },
});
