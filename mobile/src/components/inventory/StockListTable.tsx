import { memo, useCallback, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { GridEmptyProps } from '@/components/shared/CardGrid';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import type { IconName } from '@/components/ui/Icon';
import { StatCard } from '@/components/ui/StatCard';
import { colors, layout, spacing, type StatAccentKey } from '@/constants/theme';
import type { CursorListGridState } from '@/hooks/useCursorList';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage, isApiError } from '@/services/api';
import type { InventorySummary } from '@/services/types';
import { formatCount } from '@pos/core/numbers';

/** The list state of any cursor list (`useKeyedCursorList().grid`), whatever its row type. */
type ListGrid = Omit<CursorListGridState, 'onRefresh'> & { onRefresh: () => Promise<unknown> };

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

type SummaryTile = { key: 'tracked' | 'low' | 'out'; label: string; short: string; icon: IconName; accent: StatAccentKey | null };

/** MASTER §1.4: Low and Out are stock figures (orange); Tracked stays neutral. */
const SUMMARY_TILES: readonly SummaryTile[] = [
  { key: 'tracked', label: 'Tracked', short: 'Tracked', icon: 'cube-outline', accent: null },
  { key: 'low', label: 'Low stock', short: 'Low', icon: 'trending-down-outline', accent: 'stock' },
  { key: 'out', label: 'Out of stock', short: 'Out', icon: 'alert-circle-outline', accent: 'stock' },
];

/**
 * The stock summary (`meta.summary`) as stat cards (MASTER §3): Tracked
 * (neutral), Low stock and Out of stock (the orange stock accent); "—" until
 * the first page arrives. Test IDs: `<prefix>-summary-<key>`.
 */
export const StockSummaryCards = memo(function StockSummaryCards({ summary, testIDPrefix }: { summary: InventorySummary | null; testIDPrefix: string }) {
  const { isPhone } = useResponsive();
  return (
    <View style={[styles.summary, isPhone && styles.summaryPhone]} accessibilityRole="summary" testID={`${testIDPrefix}-summary`}>
      {SUMMARY_TILES.map((tile) => (
        <StatCard
          key={tile.key}
          label={isPhone ? tile.short : tile.label}
          value={summary ? formatCount(summary[tile.key]) : '—'}
          icon={tile.icon}
          accent={tile.accent}
          testID={`${testIDPrefix}-summary-${tile.key}`}
        />
      ))}
    </View>
  );
});

// ---------------------------------------------------------------------------
// The list body
// ---------------------------------------------------------------------------

type StockListBodyProps<T> = {
  items: readonly T[];
  grid: ListGrid;
  columns: readonly DataTableColumn<T>[];
  keyExtractor: (row: T) => string;
  onRowPress: (row: T) => void;
  rowTestID: (row: T) => string;
  rowAccessibilityLabel: (row: T) => string;
  rowAccessibilityHint: string;
  /** Phones: the stock cards. */
  renderCard: (row: T) => ReactElement;
  empty: GridEmptyProps;
  /** Above the table (the summary cards); scrolls with the rows. */
  header: ReactElement;
  /** The list: `<id>`, `<id>-loading`, `<id>-empty`, `<id>-error`, `<id>-updating`, `<id>-loading-more`, `<id>-more-error`. */
  testID: string;
};

/**
 * An inventory list (products or ingredients) with every state: skeleton rows
 * on first load, error with Retry (403 → "No access"), empty with a helpful
 * message, pull-to-refresh, infinite scroll and the "Showing n" footer with
 * Load more. The table in landscape; the stock cards in portrait and on phones (MASTER §6).
 */
export function StockListBody<T>({
  items,
  grid,
  columns,
  keyExtractor,
  onRowPress,
  rowTestID,
  rowAccessibilityLabel,
  rowAccessibilityHint,
  renderCard,
  empty,
  header,
  testID,
}: StockListBodyProps<T>) {
  const { gutter, screenPaddingX, screenPaddingY, contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { onRefresh } = grid;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
  );

  if (items.length === 0 && grid.error) {
    const noAccess = isApiError(grid.error) && grid.error.status === 403;
    return (
      <ErrorState
        title={noAccess ? 'No access' : "Couldn't load this list"}
        icon={noAccess ? 'lock-closed-outline' : 'cloud-offline-outline'}
        message={getErrorMessage(grid.error)}
        onRetry={grid.onRetry}
        refreshControl={refreshControl}
        testID={`${testID}-error`}
      />
    );
  }

  function loadMore() {
    if (grid.hasNextPage && !grid.isFetchingNextPage && !grid.nextPageError) grid.fetchNextPage();
  }

  return (
    <DataTable
      columns={columns}
      rows={items}
      keyExtractor={keyExtractor}
      onRowPress={onRowPress}
      rowAccessibilityLabel={rowAccessibilityLabel}
      rowAccessibilityHint={rowAccessibilityHint}
      rowTestID={rowTestID}
      renderCard={renderCard}
      cardsInPortrait
      pagination={{
        shown: items.length,
        hasNextPage: grid.hasNextPage,
        isFetchingNextPage: grid.isFetchingNextPage,
        nextPageError: grid.nextPageError,
        fetchNextPage: grid.fetchNextPage,
      }}
      loading={grid.loading && items.length === 0}
      empty={<EmptyState {...empty} testID={`${testID}-empty`} />}
      ListHeaderComponent={
        <View style={styles.header}>
          {header}
          {grid.updating ? <ActivityIndicator color={colors.primaryBright} testID={`${testID}-updating`} /> : null}
        </View>
      }
      refreshControl={refreshControl}
      onEndReached={loadMore}
      contentContainerStyle={[
        styles.content,
        {
          maxWidth: contentMaxWidth,
          paddingHorizontal: screenPaddingX,
          paddingTop: gutter,
          paddingBottom: insets.bottom + screenPaddingY + layout.tabBarHeight,
        },
      ]}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  summaryPhone: {
    gap: spacing.sm,
  },
  header: {
    gap: spacing.sm,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
});
