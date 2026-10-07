import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReorderLevelDialog, StockMovementDialog } from '@/components/inventory/InventoryDialogs';
import { INVENTORY_OFFLINE_MESSAGE, MOVEMENT_TYPES, reorderText, STOCK_STATUS_CHIP } from '@/components/inventory/inventoryLabels';
import { MovementRow } from '@/components/inventory/MovementRow';
import {
  HistoryCardEnd,
  HistoryCardStart,
  HistoryHeader,
  historyFooter,
  historyState,
  StockActions,
  StockHeaderCard,
  type StockAction,
} from '@/components/inventory/StockDetailParts';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
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
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatPeso } from '@/utils/money';
import { formatCount } from '@/utils/numbers';
import { goBackOr } from '@/utils/navigation';

function backToInventory() {
  goBackOr(ROUTES.inventory);
}

function movementKey(movement: InventoryMovement): string {
  return movement.ulid;
}

function openOrder(orderUlid: string) {
  router.push(orderRoute(orderUlid));
}

const NOT_FOUND = new ApiError('This product was not found.', { status: 404, kind: 'http' });

/**
 * One product's stock (`/inventory/[productId]`; `inventory.adjust` or `report.view`).
 * - The header card: the name and status chip, the on hand and cost tiles,
 *   the reorder level with **Edit** (`inventory.adjust`), stock value and last movement.
 * - **Stock in** (tonal), **Count** and **Wastage** (`inventory.adjust`), each an
 *   idempotent dialog.
 * - The history: an infinite list, newest first, with a type filter; each row
 *   has a soft icon tile coloured by its kind and a signed delta. Sale, void
 *   and refund movements show their order reference, which opens the order.
 * - After any write the summary and history refresh, and a stock sync runs
 *   (the Sell badges). Pull-to-refresh; a centred column (max 640).
 */
export function InventoryDetailScreen({ productId }: { productId: number | null }) {
  const itemQuery = useInventoryItem(productId);
  const [typeFilter, setTypeFilter] = useState<StockMovementType | null>(null);
  const history = useInventoryMovements(productId, typeFilter);
  const { canAdjust, canOpenOrders } = useInventoryPermissions();
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const online = useIsOnline();
  const { screenPaddingX, screenPaddingY, gutter } = useResponsive();
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
  const renderItem = useCallback(
    ({ item: movement }: ListRenderItemInfo<InventoryMovement>) => (
      <MovementRow movement={movement} timeZone={timeZone} onOpenReference={onOpenReference} />
    ),
    [timeZone, onOpenReference],
  );

  const actions = useMemo<StockAction[]>(
    () => [
      { key: 'receipt', title: 'Stock in', icon: 'arrow-down-circle-outline', variant: 'tonal', onPress: stockIn.open, testID: 'inventory-action-receipt' },
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
  const loadMoreFooter = historyFooter(history, 'inventory-history');

  function loadMore() {
    if (history.hasNextPage && !history.isFetchingNextPage && !history.grid.nextPageError) history.grid.fetchNextPage();
  }

  const header = (
    <View style={[styles.header, { gap: gutter }]}>
      {online ? null : <Banner variant="warning" message={INVENTORY_OFFLINE_MESSAGE} testID="inventory-detail-offline" />}
      {notice ? <Banner variant="success" message={notice} testID="inventory-notice" /> : null}
      {itemQuery.isError && item ? <Banner variant="warning" message={getErrorMessage(itemQuery.error)} /> : null}
      {item ? (
        <StockHeaderCard
          name={item.name}
          caption={`${item.category.name}${item.sku ? ` · ${item.sku}` : ''}`}
          status={STOCK_STATUS_CHIP[item.status]}
          metrics={[
            { label: 'On hand', value: formatCount(item.qty), danger: item.qty <= 0, testID: 'inventory-summary-qty' },
            { label: 'Cost', value: formatPeso(item.cost_cents), testID: 'inventory-summary-cost' },
          ]}
          reorderText={reorderText(item.reorder_level)}
          onEditReorder={canAdjust ? reorder.open : undefined}
          stockValue={formatPeso(item.stock_value_cents)}
          lastMovement={item.last_movement_at ? (formatBranchDateTime(item.last_movement_at, timeZone) ?? item.last_movement_at) : null}
          testID="inventory-summary"
          editTestID="inventory-reorder-edit"
        />
      ) : (
        <Card style={styles.state} testID="inventory-not-tracked">
          <Text style={styles.stateTitle}>{getErrorMessage(itemQuery.error)}</Text>
          <Text style={styles.stateText}>Its past movements still show below.</Text>
        </Card>
      )}
      {canAdjust && item ? <StockActions actions={actions} testID="inventory-actions" /> : null}
      <HistoryHeader
        types={MOVEMENT_TYPES}
        value={typeFilter}
        onChange={setTypeFilter}
        testIDPrefix="inventory-type"
        testID="inventory-history-types"
      />
      {history.grid.updating ? <ActivityIndicator color={colors.primaryBright} testID="inventory-history-updating" /> : null}
      {state}
      {hasRows ? <HistoryCardStart /> : null}
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
        <FlatList
          data={hasRows ? history.items : []}
          keyExtractor={movementKey}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListFooterComponent={
            <>
              {hasRows ? <HistoryCardEnd /> : null}
              {loadMoreFooter}
            </>
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          initialNumToRender={12}
          windowSize={11}
          contentContainerStyle={[
            styles.content,
            {
              paddingHorizontal: screenPaddingX,
              paddingTop: screenPaddingY,
              paddingBottom: insets.bottom + screenPaddingY + layout.tabBarHeight,
            },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
          }
          keyboardShouldPersistTaps="handled"
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
    maxWidth: layout.receiptMaxWidth,
    alignSelf: 'center',
  },
  header: {
    paddingBottom: spacing.none,
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
