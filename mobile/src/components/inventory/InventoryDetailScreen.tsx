import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReorderLevelDialog, StockMovementDialog } from '@/components/inventory/InventoryDialogs';
import { INVENTORY_OFFLINE_MESSAGE, MOVEMENT_TYPES, reorderText, STOCK_STATUS_CHIP } from '@/components/inventory/inventoryLabels';
import { MovementCard, movementColumns, movementTestID, productMovementView } from '@/components/inventory/MovementRow';
import { HistoryHeader, historyPagination, historyState, StockActions, StockSummary, type StockAction } from '@/components/inventory/StockDetailParts';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { TopBar } from '@/components/ui/TopBar';
import { orderRoute, ROUTES } from '@/constants/routes';
import { colors, layout, spacing, typography } from '@/constants/theme';
import { useInventoryItem, useInventoryMovements, useInventoryPermissions } from '@/hooks/inventory/useInventory';
import { useReorderLevelDialog, useStockDialog } from '@/hooks/inventory/useInventoryActions';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useResponsive } from '@/hooks/useResponsive';
import { ApiError, getErrorMessage, isApiError } from '@/services/api';
import type { InventoryMovement, StockMovementType } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { formatCount, NO_VALUE } from '@pos/core/numbers';
import { goBackOr } from '@/utils/navigation';

function backToInventory() {
  goBackOr(ROUTES.inventory);
}

function movementKey(movement: InventoryMovement): string {
  return movement.ulid;
}

function rowTestID(movement: InventoryMovement): string {
  return movementTestID(movement.ulid);
}

function openOrder(orderUlid: string) {
  router.push(orderRoute(orderUlid));
}

const NOT_FOUND = new ApiError('This product was not found.', { status: 404, kind: 'http' });

/**
 * One product's stock (`/inventory/[productId]`; `inventory.adjust` or `report.view`),
 * structured like the web stock page:
 * - the header: the name with its status badge, category · SKU, the last
 *   movement, and **Stock in** (green) / **Count** / **Wastage** (outline;
 *   `inventory.adjust`), each an idempotent dialog;
 * - stat cards: On hand (orange only when Low / Out), Cost, Stock value and
 *   the reorder level with **Edit** (`inventory.adjust`);
 * - the history, newest first, with a type filter: a table in tablet
 *   landscape, cards in portrait and on phones, then "Showing n" and
 *   **Load more**. Sale, void and refund movements link to their order.
 * After any write the summary and history refresh, and a stock sync runs
 * (the Sell badges). Pull-to-refresh.
 */
export function InventoryDetailScreen({ productId }: { productId: number | null }) {
  const itemQuery = useInventoryItem(productId);
  const [typeFilter, setTypeFilter] = useState<StockMovementType | null>(null);
  const history = useInventoryMovements(productId, typeFilter);
  const { canAdjust, canOpenOrders } = useInventoryPermissions();
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const online = useIsOnline();
  const { screenPaddingX, screenPaddingY, gutter, isTablet, contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 409: the product doesn't track stock. Its message shows, and its history still does.
  const notTracked = itemQuery.isError && isApiError(itemQuery.error) && itemQuery.error.status === 409;
  const item = notTracked ? null : (itemQuery.data ?? null);
  const stockIn = useStockDialog(item, 'receipt', setNotice);
  const count = useStockDialog(item, 'count', setNotice);
  const wastage = useStockDialog(item, 'wastage', setNotice);
  const reorder = useReorderLevelDialog(item, setNotice);

  const onOpenReference = canOpenOrders ? openOrder : undefined;
  const toView = useCallback((movement: InventoryMovement) => productMovementView(movement, timeZone, onOpenReference), [timeZone, onOpenReference]);
  const columns = useMemo(() => movementColumns(toView), [toView]);
  const renderCard = useCallback((movement: InventoryMovement) => <MovementCard {...toView(movement)} />, [toView]);

  const actions = useMemo<StockAction[]>(
    () => [
      { key: 'receipt', title: 'Stock in', icon: 'arrow-down-circle-outline', variant: 'primary', onPress: stockIn.open, testID: 'inventory-action-receipt' },
      { key: 'count', title: 'Count', icon: 'clipboard-outline', variant: 'secondary', onPress: count.open, testID: 'inventory-action-count' },
      { key: 'wastage', title: 'Wastage', icon: 'trash-outline', variant: 'secondary', onPress: wastage.open, testID: 'inventory-action-wastage' },
    ],
    [stockIn.open, count.open, wastage.open],
  );

  // Loading (no cached card yet), 404 ("Not found") or another error with Retry.
  if (productId === null || (item === null && !notTracked)) {
    let error: unknown = null;
    if (productId === null) error = NOT_FOUND;
    else if (itemQuery.isError) error = itemQuery.error;
    return (
      <RecordLoadState title="Stock" error={error} onRetry={() => void itemQuery.refetch()} onBack={backToInventory} testID="inventory-detail-state" />
    );
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([itemQuery.refetch(), history.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  const state = historyState(history, typeFilter !== null, 'Stock in, sales, counts and wastage show here, newest first.', 'inventory-history');
  const hasRows = state === null;

  function loadMore() {
    if (history.hasNextPage && !history.isFetchingNextPage && !history.grid.nextPageError) history.grid.fetchNextPage();
  }

  const header = (
    <View style={{ gap: gutter }}>
      {online ? null : <Banner variant="warning" message={INVENTORY_OFFLINE_MESSAGE} testID="inventory-detail-offline" />}
      {notice ? <Banner variant="success" message={notice} testID="inventory-notice" /> : null}
      {itemQuery.isError && item ? <Banner variant="warning" message={getErrorMessage(itemQuery.error)} /> : null}
      {item ? (
        <StockSummary
          name={item.name}
          caption={`${item.category.name}${item.sku ? ` · ${item.sku}` : ''}`}
          status={STOCK_STATUS_CHIP[item.status]}
          stockStatus={item.status}
          lastMovement={item.last_movement_at ? (formatBranchDateTime(item.last_movement_at, timeZone) ?? item.last_movement_at) : null}
          actions={canAdjust ? <StockActions actions={actions} testID="inventory-actions" /> : null}
          stats={[
            { key: 'qty', label: 'On hand', value: formatCount(item.qty), icon: 'cube-outline', testID: 'inventory-summary-qty' },
            { key: 'cost', label: 'Cost', value: formatPeso(item.cost_cents), icon: 'pricetag-outline', testID: 'inventory-summary-cost' },
            { key: 'value', label: 'Stock value', value: formatPeso(item.stock_value_cents), icon: 'cash-outline', testID: 'inventory-summary-value' },
            {
              key: 'reorder',
              label: 'Reorder level',
              value: item.reorder_level === null ? NO_VALUE : formatCount(item.reorder_level),
              icon: 'notifications-outline',
              footnote: reorderText(item.reorder_level),
              testID: 'inventory-summary-reorder-level',
              footnoteTestID: 'inventory-summary-reorder',
              action: canAdjust ? { title: 'Edit', onPress: reorder.open, testID: 'inventory-reorder-edit' } : null,
            },
          ]}
          testID="inventory-summary"
        />
      ) : (
        <Card style={styles.state} testID="inventory-not-tracked">
          <Text style={styles.stateTitle}>{getErrorMessage(itemQuery.error)}</Text>
          <Text style={styles.stateText}>Its past movements still show below.</Text>
        </Card>
      )}
      <HistoryHeader
        types={MOVEMENT_TYPES}
        value={typeFilter}
        onChange={setTypeFilter}
        testIDPrefix="inventory-type"
        testID="inventory-history-types"
      />
      {history.grid.updating ? <ActivityIndicator color={colors.primaryBright} testID="inventory-history-updating" /> : null}
    </View>
  );

  return (
    <Screen edges={[]} testID="inventory-detail-screen">
      <TopBar
        title={item?.name ?? 'Stock history'}
        subtitle={item ? `${item.category.name}${item.sku ? ` · ${item.sku}` : ''}` : undefined}
        left={<IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back" onPress={backToInventory} testID="inventory-detail-back" />}
        testID="inventory-detail-header"
      />
      <SafeAreaView edges={['left', 'right']} style={styles.fill}>
        <DataTable
          columns={columns}
          rows={hasRows ? history.items : []}
          keyExtractor={movementKey}
          rowTestID={rowTestID}
          rowAccessible={false}
          renderCard={renderCard}
          cardsInPortrait
          rowHeight="auto"
          empty={state}
          pagination={hasRows ? historyPagination(history) : null}
          ListHeaderComponent={header}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={[
            styles.content,
            {
              maxWidth: isTablet ? Math.min(contentMaxWidth, layout.formWideMaxWidth) : layout.receiptMaxWidth,
              paddingHorizontal: screenPaddingX,
              paddingTop: screenPaddingY,
              paddingBottom: insets.bottom + screenPaddingY + layout.tabBarHeight,
            },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
          }
          testID="inventory-history"
        />
      </SafeAreaView>

      {item ? (
        <>
          <StockMovementDialog dialog={stockIn} item={item} />
          <StockMovementDialog dialog={count} item={item} />
          <StockMovementDialog dialog={wastage} item={item} />
          <ReorderLevelDialog dialog={reorder} item={item} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
  state: {
    alignItems: 'center',
    gap: spacing.md,
  },
  stateTitle: {
    ...typography.heading,
    color: colors.text,
    textAlign: 'center',
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
