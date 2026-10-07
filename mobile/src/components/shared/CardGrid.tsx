import { useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import type { IconName } from '@/components/ui/Icon';
import { LoadingState } from '@/components/ui/LoadingState';
import { colors, layout, spacing } from '@/constants/theme';
import { useGridScrollRestore } from '@/hooks/useGridScrollRestore';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage, isApiError } from '@/services/api';
import { toGridSlots, type GridSlot } from '@/utils/grid';

export type GridEmptyProps = {
  title: string;
  message?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
};

type CardGridProps<T> = {
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  /** First load (no data yet). */
  loading: boolean;
  /** The first page failed and there is nothing to show. */
  error: unknown;
  onRetry: () => void;
  /** Pull-to-refresh: resolves when the refetch finishes. */
  onRefresh: () => Promise<unknown>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Loading the next page failed (the loaded items stay visible). */
  nextPageError: unknown;
  fetchNextPage: () => void;
  empty: GridEmptyProps;
  /** Shown above the cards (e.g. a toggle error banner). */
  header?: ReactNode;
  /** New results are loading while the previous ones stay visible (e.g. after a search). */
  updating?: boolean;
  testID: string;
};

/** Title + icon for a list that could not load. A 403 is a permissions problem, not a network one. */
function describeError(error: unknown): { title: string; icon: IconName } {
  if (isApiError(error) && error.status === 403) return { title: 'No access', icon: 'lock-closed-outline' };
  return { title: "Couldn't load this list", icon: 'cloud-offline-outline' };
}

/**
 * Responsive, cursor-paginated card grid with every list state:
 * - loading (first load), error with Retry (403 → "No access"), empty with a
 *   helpful message, pull-to-refresh (also on the empty and error states)
 * - infinite scroll via `onEndReached` (+ a footer spinner, or a Retry when a page fails)
 * - `useResponsive().columns` columns; the FlatList is keyed by the column
 *   count and `useGridScrollRestore` keeps the first visible card on rotation
 * - bottom padding includes the safe-area inset (and any tab bar)
 */
export function CardGrid<T>({
  items,
  keyOf,
  renderItem,
  loading,
  error,
  onRetry,
  onRefresh,
  hasNextPage,
  isFetchingNextPage,
  nextPageError,
  fetchNextPage,
  empty,
  header,
  updating = false,
  testID,
}: CardGridProps<T>) {
  const { columns, gutter, screenPaddingX, screenPaddingY, contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const { listRef, listKey, onViewableItemsChanged, viewabilityConfig, onScrollToIndexFailed } =
    useGridScrollRestore<GridSlot<T>>(columns);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      colors={[colors.primaryBright]}
      tintColor={colors.primaryBright}
    />
  );

  if (loading) return <LoadingState variant="grid" testID={`${testID}-loading`} />;

  if (items.length === 0 && error) {
    const { title, icon } = describeError(error);
    return (
      <ErrorState
        title={title}
        icon={icon}
        message={getErrorMessage(error)}
        onRetry={onRetry}
        refreshControl={refreshControl}
        testID={`${testID}-error`}
      />
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.fill}>
        {header ? <View style={{ paddingHorizontal: screenPaddingX, paddingTop: gutter }}>{header}</View> : null}
        <EmptyState {...empty} refreshControl={refreshControl} testID={`${testID}-empty`} />
      </View>
    );
  }

  const multiColumn = columns > 1;

  function loadMore() {
    if (hasNextPage && !isFetchingNextPage && !nextPageError) fetchNextPage();
  }

  let footer: ReactElement | null = null;
  if (isFetchingNextPage) {
    footer = (
      <View style={styles.footer} testID={`${testID}-loading-more`}>
        <ActivityIndicator color={colors.primaryBright} />
      </View>
    );
  } else if (nextPageError) {
    footer = (
      <View style={[styles.footer, { gap: spacing.md }]} testID={`${testID}-more-error`}>
        <Banner message={getErrorMessage(nextPageError)} />
        <Button title="Load more" leftIcon="refresh" variant="secondary" onPress={fetchNextPage} />
      </View>
    );
  }

  return (
    <FlatList
      key={listKey}
      ref={listRef}
      data={toGridSlots(items, columns, keyOf)}
      numColumns={columns}
      keyExtractor={(slot) => slot.key}
      renderItem={({ item: slot }) => (
        <View style={multiColumn ? styles.cellMulti : styles.cellSingle}>{slot.item ? renderItem(slot.item) : null}</View>
      )}
      columnWrapperStyle={multiColumn ? [styles.row, { gap: gutter }] : undefined}
      ListHeaderComponent={
        header || updating ? (
          <View style={styles.headerStack}>
            {updating ? <ActivityIndicator color={colors.primaryBright} testID={`${testID}-updating`} /> : null}
            {header}
          </View>
        ) : null
      }
      ListFooterComponent={footer}
      contentContainerStyle={[
        styles.content,
        {
          gap: gutter,
          maxWidth: contentMaxWidth,
          paddingHorizontal: screenPaddingX,
          paddingTop: gutter,
          paddingBottom: insets.bottom + screenPaddingY + layout.tabBarHeight,
        },
      ]}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      onScrollToIndexFailed={onScrollToIndexFailed}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  headerStack: {
    gap: spacing.sm,
  },
  fill: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    alignItems: 'stretch',
  },
  cellSingle: {
    width: '100%',
  },
  cellMulti: {
    flex: 1,
  },
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'stretch',
  },
});
