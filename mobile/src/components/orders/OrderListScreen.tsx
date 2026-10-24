import { router } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { OrderCard } from '@/components/orders/OrderCard';
import { OrderDateBar } from '@/components/orders/OrderDateBar';
import { orderAccessibilityLabel, orderRowTestID, useOrderColumns } from '@/components/orders/OrderTable';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ActionMenu, type MenuAction } from '@/components/ui/ActionMenu';
import { Banner } from '@/components/ui/Banner';
import { DataTable } from '@/components/ui/DataTable';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Screen } from '@/components/ui/Screen';
import { orderRoute, refundRoute } from '@/constants/routes';
import { colors, layout, radius, shadows, sizes, spacing } from '@/constants/theme';
import { ORDER_SEARCH_MAX_LENGTH, useOrderListScreen, type OrderListEntry } from '@/hooks/orders/useOrders';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage, isApiError } from '@/services/api';
import { useSessionStore } from '@/stores/session';
import { orderNumberLabel } from '@/sale/localOrder';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';

function entryKey(entry: OrderListEntry): string {
  return entry.key;
}

function openOrder(entry: OrderListEntry) {
  router.push(orderRoute(entry.order.ulid));
}

type ActionPermissions = { canVoid: boolean; canRefund: boolean };

/**
 * The row menu (⋯) of an order: View, Reprint, and Void or Refund where the
 * user's permissions and the order's status allow. Each goes through the
 * order detail's existing flow (the Reprint chooser, the void dialog with its
 * gating and approval, the refund screen), which checks again.
 */
function rowActionsFor(entry: OrderListEntry, permissions: ActionPermissions): MenuAction[] {
  const { order } = entry;
  const actions: MenuAction[] = [
    { key: 'view', label: 'View', icon: 'eye-outline', onPress: () => openOrder(entry) },
    { key: 'reprint', label: 'Reprint', icon: 'print-outline', onPress: () => router.push(orderRoute(order.ulid, 'reprint')) },
  ];
  // A sale saved on this tablet (no invoice yet) can't be voided or refunded until it syncs.
  if (entry.kind === 'server') {
    if (permissions.canRefund && (order.status === 'completed' || order.status === 'partially_refunded')) {
      actions.push({ key: 'refund', label: 'Refund', icon: 'return-down-back-outline', onPress: () => router.push(refundRoute(order.ulid)) });
    }
    if (permissions.canVoid && order.status === 'completed') {
      actions.push({ key: 'void', label: 'Void order', icon: 'close-circle-outline', destructive: true, onPress: () => router.push(orderRoute(order.ulid, 'void')) });
    }
  }
  return actions;
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
 * error with Retry (403 → "No access"), pull-to-refresh, and the "Showing n"
 * footer with **Load more** (also loaded on scroll; Retry when a page fails).
 * Without `report.view` the server lists only the user's own sales.
 * MASTER §6 / back-office.md: the band carries the title, the scope and the
 * branch and business date; the search and the date bar sit in a white card
 * over it; the table shows in landscape and the cards in portrait; each row's
 * ⋯ menu offers View, Reprint, Refund and Void order.
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
  const user = useSessionStore((state) => state.user);
  const permissions = useMemo<ActionPermissions>(
    () => ({
      canVoid: hasAnyPermission(user, [PERMISSIONS.saleCreate, PERMISSIONS.saleVoid]),
      canRefund: hasAnyPermission(user, [PERMISSIONS.saleCreate, PERMISSIONS.saleRefund]),
    }),
    [user],
  );
  const [menuEntry, setMenuEntry] = useState<OrderListEntry | null>(null);
  const rowActions = useCallback(
    (entry: OrderListEntry) => (
      <IconButton
        icon="ellipsis-horizontal"
        variant="ghost"
        accessibilityLabel={`Actions for ${orderNumberLabel(entry.order)}`}
        onPress={() => setMenuEntry(entry)}
        testID={`${orderRowTestID(entry)}-actions`}
      />
    ),
    [],
  );

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
        cardsInPortrait
        rowActions={rowActions}
        pagination={{
          shown: entries.length,
          hasNextPage: grid.hasNextPage,
          isFetchingNextPage: grid.isFetchingNextPage,
          nextPageError: grid.nextPageError,
          fetchNextPage: grid.fetchNextPage,
        }}
        loading={grid.loading && entries.length === 0}
        empty={<EmptyState {...copy} refreshControl={refreshControl} testID="orders-grid-empty" />}
        ListHeaderComponent={header}
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
      <ListHeader band subtitle={seesAll ? 'All sales in this branch' : 'Your sales'} title="Order History" testIDPrefix="orders" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <View style={[styles.toolbar, { marginHorizontal: screenPaddingX, maxWidth: contentMaxWidth }]} testID="orders-toolbar">
          <ListFilters
            search={screen.search}
            onSearchChange={screen.setSearch}
            searching={screen.searching}
            placeholder="Invoice number"
            searchTestID="order-search"
            searchMaxLength={ORDER_SEARCH_MAX_LENGTH}
          />
          <OrderDateBar screen={screen} />
        </View>
        {body}
      </SafeAreaView>
      <ActionMenu
        title={menuEntry ? orderNumberLabel(menuEntry.order) : null}
        actions={menuEntry ? rowActionsFor(menuEntry, permissions) : []}
        onClose={() => setMenuEntry(null)}
        testID="order-actions"
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
  header: {
    gap: spacing.sm,
  },
  /** The search and the date bar: a white card over the band. */
  toolbar: {
    alignSelf: 'stretch',
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
});
