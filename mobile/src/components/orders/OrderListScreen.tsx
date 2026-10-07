import { router } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { OrderCard } from '@/components/orders/OrderCard';
import { OrderDateBar } from '@/components/orders/OrderDateBar';
import { orderAccessibilityLabel, orderRowTestID, useOrderColumns } from '@/components/orders/OrderTable';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Screen } from '@/components/ui/Screen';
import { orderRoute } from '@/constants/routes';
import { colors, layout, spacing } from '@/constants/theme';
import { ORDER_SEARCH_MAX_LENGTH, useOrderListScreen, type OrderListEntry } from '@/hooks/orders/useOrders';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage, isApiError } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

function entryKey(entry: OrderListEntry): string {
  return entry.key;
}

function openOrder(entry: OrderListEntry) {
  router.push(orderRoute(entry.order.ulid));
}

type EmptyCopy = { title: string; message?: string; icon: 'checkmark-done-outline' | 'search-outline' | 'receipt-outline' | 'calendar-outline'; actionLabel?: string; onAction?: () => void };

/**
 * Orders (`sale.create` or `report.view`): today's business date by default,
 * a date selector, the Status and Needs review filters, invoice search
 * (300 ms debounce) and infinite scroll.
 * - Tablets: a table (Sage "Orders" board): order, time, table, customer,
 *   payment, total and status; tapping a row opens the receipt.
 * - Phones: the order cards.
 * Every state: skeleton rows on first load, empty with a helpful message,
 * error with Retry (403 → "No access"), pull-to-refresh, and a load-more
 * footer (with Retry when a page fails). Without `report.view` the server
 * lists only the user's own sales.
 *
 * Offline Sales (Phase 5): the day's unsynced local sales come first, with a
 * badge; with `order.review`, a **Needs review** filter (the dashboard insight opens it).
 */
export function OrderListScreen() {
  const screen = useOrderListScreen();
  const seesAll = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.reportView));
  const { isTablet, isLandscape, gutter, screenPaddingX, screenPaddingY, contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const { grid } = screen.list;
  const entries = screen.entries;
  const showDate = screen.allDates || screen.needsReview;
  const columns = useOrderColumns({ showDate, wide: isTablet && isLandscape });

  const { onRefresh } = grid;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const renderCard = useCallback(
    (entry: OrderListEntry) => (
      <OrderCard
        order={entry.order}
        badge={entry.kind === 'local' ? entry.badge : undefined}
        showDate={showDate}
        onPress={() => openOrder(entry)}
      />
    ),
    [showDate],
  );
  const rowLabel = useCallback(
    (entry: OrderListEntry) => orderAccessibilityLabel(entry.order, showDate, entry.kind === 'local' ? entry.badge : undefined),
    [showDate],
  );

  let copy: EmptyCopy;
  if (screen.needsReview) {
    copy = {
      title: 'No sales need review',
      message: 'Offline sales the server flagged show here until a manager marks them reviewed.',
      icon: 'checkmark-done-outline',
      actionLabel: 'Show today',
      onAction: screen.showToday,
    };
  } else if (screen.filtersActive) {
    copy = {
      title: 'No matching orders',
      message: 'Check the invoice number, or look on another day.',
      icon: 'search-outline',
      actionLabel: 'Clear search',
      onAction: screen.clearSearch,
    };
  } else if (screen.allDates) {
    copy = { title: 'No orders yet', message: 'Completed sales show here.', icon: 'receipt-outline' };
  } else if (screen.isToday) {
    copy = { title: 'No sales yet today', message: 'Completed sales show here as they happen.', icon: 'receipt-outline' };
  } else {
    copy = {
      title: 'No orders on this day',
      message: 'Try another day, or show all dates.',
      icon: 'calendar-outline',
      actionLabel: 'Show all dates',
      onAction: screen.showAllDates,
    };
  }

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
  );

  function loadMore() {
    if (grid.hasNextPage && !grid.isFetchingNextPage && !grid.nextPageError) grid.fetchNextPage();
  }

  let body: ReactElement;
  if (entries.length === 0 && grid.error) {
    const noAccess = isApiError(grid.error) && grid.error.status === 403;
    body = (
      <ErrorState
        title={noAccess ? 'No access' : "Couldn't load this list"}
        icon={noAccess ? 'lock-closed-outline' : 'cloud-offline-outline'}
        message={getErrorMessage(grid.error)}
        onRetry={grid.onRetry}
        refreshControl={refreshControl}
        testID="orders-grid-error"
      />
    );
  } else {
    // Offline, the local sales still show; the banner says why the API's orders are missing.
    const serverError =
      grid.error && entries.length > 0 ? (
        <Banner variant="warning" message={`Synced orders couldn't load: ${getErrorMessage(grid.error)}`} testID="orders-server-error" />
      ) : null;
    const header =
      serverError || grid.updating ? (
        <View style={styles.header}>
          {grid.updating ? <ActivityIndicator color={colors.primaryBright} testID="orders-grid-updating" /> : null}
          {serverError}
        </View>
      ) : null;

    let footer: ReactElement | null = null;
    if (grid.isFetchingNextPage) {
      footer = (
        <View style={styles.footer} testID="orders-grid-loading-more">
          <ActivityIndicator color={colors.primaryBright} />
        </View>
      );
    } else if (grid.nextPageError) {
      footer = (
        <View style={[styles.footer, styles.footerError]} testID="orders-grid-more-error">
          <Banner message={getErrorMessage(grid.nextPageError)} />
          <Button title="Load more" leftIcon="refresh" variant="secondary" onPress={grid.fetchNextPage} />
        </View>
      );
    }

    body = (
      <DataTable
        columns={columns}
        rows={entries}
        keyExtractor={entryKey}
        onRowPress={openOrder}
        rowAccessibilityLabel={rowLabel}
        rowAccessibilityHint="Opens the receipt"
        rowTestID={orderRowTestID}
        renderCard={renderCard}
        loading={grid.loading && entries.length === 0}
        empty={<EmptyState {...copy} refreshControl={refreshControl} testID="orders-grid-empty" />}
        ListHeaderComponent={header}
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
        testID="orders-grid"
      />
    );
  }

  return (
    <Screen edges={[]} testID="order-list-screen">
      <ListHeader subtitle={seesAll ? 'All sales in this branch' : 'Your sales'} title="Orders" testIDPrefix="orders" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListFilters
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="Invoice number"
          searchTestID="order-search"
          searchMaxLength={ORDER_SEARCH_MAX_LENGTH}
        />
        <OrderDateBar screen={screen} />
        {body}
      </SafeAreaView>
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
  header: {
    gap: spacing.sm,
  },
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'stretch',
  },
  footerError: {
    gap: spacing.md,
  },
});
