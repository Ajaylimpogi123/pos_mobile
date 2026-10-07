import { memo, useCallback, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { GridEmptyProps } from '@/components/shared/CardGrid';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { colors, layout, radius, sizes, spacing, status, typography } from '@/constants/theme';
import type { CursorListGridState } from '@/hooks/useCursorList';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage, isApiError } from '@/services/api';
import type { InventorySummary } from '@/services/types';
import { formatCount } from '@/utils/numbers';

/** The list state of any cursor list (`useKeyedCursorList().grid`), whatever its row type. */
type ListGrid = Omit<CursorListGridState, 'onRefresh'> & { onRefresh: () => Promise<unknown> };

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

type SummaryTile = { key: 'tracked' | 'low' | 'out'; label: string; short: string; bar: string };

/** The coloured bar of each tile (Sage "Inventory" board): sage, caution, cancelled. */
const SUMMARY_TILES: readonly SummaryTile[] = [
  { key: 'tracked', label: 'Tracked', short: 'Tracked', bar: colors.accent },
  { key: 'low', label: 'Low stock', short: 'Low', bar: status.caution.color },
  { key: 'out', label: 'Out of stock', short: 'Out', bar: status.cancelled.color },
];

/**
 * The stock summary (`meta.summary`): Tracked · Low stock · Out of stock, each
 * a white card with a coloured bar, the label and a large value. Skeleton
 * values until the first page arrives. Test IDs: `<prefix>-summary-<key>`.
 */
export const StockSummaryCards = memo(function StockSummaryCards({ summary, testIDPrefix }: { summary: InventorySummary | null; testIDPrefix: string }) {
  const { isPhone } = useResponsive();
  return (
    <View style={[styles.summary, isPhone && styles.summaryPhone]} accessibilityRole="summary" testID={`${testIDPrefix}-summary`}>
      {SUMMARY_TILES.map((tile) => {
        const value = summary ? formatCount(summary[tile.key]) : null;
        return (
          <View
            key={tile.key}
            style={[styles.tile, isPhone && styles.tilePhone]}
            accessible
            accessibilityLabel={value === null ? `${tile.label}, loading` : `${tile.label}: ${value}`}
            testID={`${testIDPrefix}-summary-${tile.key}`}
          >
            <View style={[styles.bar, isPhone && styles.barPhone, { backgroundColor: tile.bar }]} />
            <View style={styles.tileText}>
              <Text style={styles.tileLabel} numberOfLines={1}>
                {isPhone ? tile.short : tile.label}
              </Text>
              {value === null ? (
                <Skeleton width="60%" height={sizes.skeleton.lineLarge} />
              ) : (
                <Text style={[styles.tileValue, isPhone && styles.tileValuePhone]} numberOfLines={1} adjustsFontSizeToFit>
                  {value}
                </Text>
              )}
            </View>
          </View>
        );
      })}
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
 * message, pull-to-refresh, and infinite scroll (a footer spinner, or Retry
 * when a page fails). Tablets: a `DataTable`; phones: the stock cards.
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

  let footer: ReactElement | null = null;
  if (grid.isFetchingNextPage) {
    footer = (
      <View style={styles.footer} testID={`${testID}-loading-more`}>
        <ActivityIndicator color={colors.primaryBright} />
      </View>
    );
  } else if (grid.nextPageError) {
    footer = (
      <View style={[styles.footer, styles.footerError]} testID={`${testID}-more-error`}>
        <Banner message={getErrorMessage(grid.nextPageError)} />
        <Button title="Load more" leftIcon="refresh" variant="secondary" onPress={grid.fetchNextPage} />
      </View>
    );
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
      loading={grid.loading && items.length === 0}
      empty={<EmptyState {...empty} testID={`${testID}-empty`} />}
      ListHeaderComponent={
        <View style={styles.header}>
          {header}
          {grid.updating ? <ActivityIndicator color={colors.primaryBright} testID={`${testID}-updating`} /> : null}
        </View>
      }
      ListFooterComponent={footer}
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
  tile: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tilePhone: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  bar: {
    width: sizes.summaryBar.tablet,
    alignSelf: 'stretch',
    minHeight: spacing.xxxl,
    borderRadius: radius.pill,
  },
  barPhone: {
    width: sizes.summaryBar.phone,
  },
  tileText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  tileLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  tileValue: {
    ...typography.metricValue,
    color: colors.text,
  },
  tileValuePhone: {
    fontSize: typography.heading.fontSize,
    lineHeight: typography.heading.lineHeight,
  },
  header: {
    gap: spacing.sm,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'stretch',
  },
  footerError: {
    gap: spacing.md,
  },
});
