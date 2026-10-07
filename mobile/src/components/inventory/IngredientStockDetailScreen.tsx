import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ingredientReorderText } from '@/components/ingredients/IngredientCard';
import { IngredientMovementRow } from '@/components/inventory/IngredientMovementRow';
import { IngredientCostDialog, IngredientReorderDialog, IngredientStockDialog } from '@/components/inventory/IngredientStockDialogs';
import { averageCostText, INGREDIENT_MOVEMENT_TYPES, INVENTORY_OFFLINE_MESSAGE, STOCK_STATUS_CHIP } from '@/components/inventory/inventoryLabels';
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
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { TopBar } from '@/components/ui/TopBar';
import { orderRoute, purchaseOrderRoute, ROUTES } from '@/constants/routes';
import { colors, layout } from '@/constants/theme';
import { useIngredientCostDialog } from '@/hooks/ingredients/useIngredientCost';
import {
  useIngredientMovements,
  useIngredientReorderDialog,
  useIngredientStockDialog,
  useIngredientStockItem,
} from '@/hooks/ingredients/useIngredientStock';
import { useInventoryPermissions } from '@/hooks/inventory/useInventory';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useResponsive } from '@/hooks/useResponsive';
import { ApiError, getErrorMessage } from '@/services/api';
import type { IngredientMovement, IngredientMovementType } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatPeso } from '@/utils/money';
import { goBackOr } from '@/utils/navigation';
import { hasAnyPermission, PURCHASING_READ_PERMISSIONS } from '@/utils/permissions';
import { formatQty, friendlyQty, isQtyAtOrBelowZero } from '@/utils/quantity';

function backToList() {
  goBackOr(ROUTES.inventoryIngredients);
}

function movementKey(movement: IngredientMovement): string {
  return movement.ulid;
}

function openOrder(ulid: string) {
  router.push(orderRoute(ulid));
}

function openPurchaseOrder(ulid: string) {
  router.push(purchaseOrderRoute(ulid));
}

const NOT_FOUND = new ApiError('This ingredient was not found.', { status: 404, kind: 'http' });

/**
 * One ingredient's stock (`/inventory/ingredients/[ingredientId]`;
 * `inventory.adjust` or `report.view`):
 * - the header card: the name and status chip, the on hand (base unit, a
 *   friendlier one under it) and average cost tiles, the reorder level with
 *   **Edit**, stock value and last movement;
 * - **Adjust**, **Count**, **Wastage** and §D1 **Set cost** (tonal) (`inventory.adjust`),
 *   each with the unit picker; stock in comes from Receiving only;
 * - the history, newest first, with the entered qty and unit, and links to
 *   the order or purchase order. Pull-to-refresh; a centred column (max 640).
 */
export function IngredientStockDetailScreen({ ingredientId }: { ingredientId: number | null }) {
  const itemQuery = useIngredientStockItem(ingredientId);
  const [typeFilter, setTypeFilter] = useState<IngredientMovementType | null>(null);
  const history = useIngredientMovements(ingredientId, typeFilter);
  const { canAdjust, canOpenOrders } = useInventoryPermissions();
  const canOpenPurchaseOrders = useSessionStore((state) => hasAnyPermission(state.user, PURCHASING_READ_PERMISSIONS));
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const online = useIsOnline();
  const { screenPaddingX, screenPaddingY, gutter } = useResponsive();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const item = itemQuery.data ?? null;
  const adjust = useIngredientStockDialog(item, 'adjustment', setNotice);
  const count = useIngredientStockDialog(item, 'count', setNotice);
  const wastage = useIngredientStockDialog(item, 'wastage', setNotice);
  const reorder = useIngredientReorderDialog(item, setNotice);
  const cost = useIngredientCostDialog(item, setNotice);

  const baseUnit = item?.base_unit ?? '';
  const onOpenOrder = canOpenOrders ? openOrder : undefined;
  const onOpenPurchaseOrder = canOpenPurchaseOrders ? openPurchaseOrder : undefined;
  const renderItem = useCallback(
    ({ item: movement }: ListRenderItemInfo<IngredientMovement>) => (
      <IngredientMovementRow
        movement={movement}
        baseUnit={baseUnit}
        timeZone={timeZone}
        onOpenOrder={onOpenOrder}
        onOpenPurchaseOrder={onOpenPurchaseOrder}
      />
    ),
    [baseUnit, timeZone, onOpenOrder, onOpenPurchaseOrder],
  );

  const actions = useMemo<StockAction[]>(
    () => [
      { key: 'adjustment', title: 'Adjust', icon: 'swap-vertical-outline', variant: 'secondary', onPress: adjust.open, testID: 'ingredient-action-adjustment' },
      { key: 'count', title: 'Count', icon: 'clipboard-outline', variant: 'secondary', onPress: count.open, testID: 'ingredient-action-count' },
      { key: 'wastage', title: 'Wastage', icon: 'trash-outline', variant: 'secondary', onPress: wastage.open, testID: 'ingredient-action-wastage' },
      { key: 'cost', title: 'Set cost', icon: 'pricetag-outline', variant: 'tonal', onPress: cost.open, testID: 'ingredient-action-cost' },
    ],
    [adjust.open, count.open, wastage.open, cost.open],
  );

  if (ingredientId === null || item === null) {
    let error: unknown = null;
    if (ingredientId === null) error = NOT_FOUND;
    else if (!online) error = new ApiError(INVENTORY_OFFLINE_MESSAGE, { status: null, kind: 'network' });
    else if (itemQuery.isError) error = itemQuery.error;
    return (
      <RecordLoadState title="Stock" error={error} onRetry={() => void itemQuery.refetch()} onBack={backToList} testID="ingredient-stock-state" />
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

  const state = historyState(
    history,
    typeFilter !== null,
    'Receipts, counts, wastage, adjustments and cost changes show here, newest first.',
    'ingredient-history',
  );
  const hasRows = state === null;
  const loadMoreFooter = historyFooter(history, 'ingredient-history');

  function loadMore() {
    if (history.hasNextPage && !history.isFetchingNextPage && !history.grid.nextPageError) history.grid.fetchNextPage();
  }

  const friendly = friendlyQty(item.qty, item.base_unit);

  const header = (
    <View style={{ gap: gutter }}>
      {online ? null : <Banner variant="warning" message={INVENTORY_OFFLINE_MESSAGE} testID="ingredient-detail-offline" />}
      {notice ? <Banner variant="success" message={notice} testID="ingredient-notice" /> : null}
      {itemQuery.isError ? <Banner variant="warning" message={getErrorMessage(itemQuery.error)} /> : null}
      <StockHeaderCard
        name={item.name}
        caption={`Base unit: ${item.base_unit}`}
        status={STOCK_STATUS_CHIP[item.status]}
        metrics={[
          {
            label: 'On hand',
            value: `${formatQty(item.qty)} ${item.base_unit}`,
            sub: friendly ? `${friendly} on hand` : 'on hand',
            danger: isQtyAtOrBelowZero(item.qty),
            testID: 'ingredient-summary-qty',
            subTestID: 'ingredient-summary-friendly',
          },
          { label: 'Avg cost', value: averageCostText(item), testID: 'ingredient-summary-cost' },
        ]}
        reorderText={ingredientReorderText(item)}
        onEditReorder={canAdjust && online ? reorder.open : undefined}
        stockValue={formatPeso(item.stock_value_cents)}
        lastMovement={item.last_movement_at ? (formatBranchDateTime(item.last_movement_at, timeZone) ?? item.last_movement_at) : null}
        testID="ingredient-summary"
        editTestID="ingredient-reorder-edit"
      />
      {canAdjust ? <StockActions actions={actions} disabled={!online} testID="ingredient-actions" /> : null}
      <HistoryHeader types={INGREDIENT_MOVEMENT_TYPES} value={typeFilter} onChange={setTypeFilter} testIDPrefix="ingredient-type" />
      {history.grid.updating ? <ActivityIndicator color={colors.primaryBright} /> : null}
      {state}
      {hasRows ? <HistoryCardStart /> : null}
    </View>
  );

  return (
    <Screen edges={[]} testID="ingredient-stock-detail-screen">
      <TopBar
        title={item.name}
        subtitle={`Base unit: ${item.base_unit}`}
        left={<IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back" onPress={backToList} testID="ingredient-detail-back" />}
        testID="ingredient-detail-header"
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
            { paddingHorizontal: screenPaddingX, paddingTop: screenPaddingY, paddingBottom: insets.bottom + screenPaddingY + layout.tabBarHeight },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
          }
          keyboardShouldPersistTaps="handled"
          testID="ingredient-history"
        />
      </SafeAreaView>
      <IngredientStockDialog dialog={adjust} item={item} />
      <IngredientStockDialog dialog={count} item={item} />
      <IngredientStockDialog dialog={wastage} item={item} />
      <IngredientReorderDialog dialog={reorder} item={item} />
      <IngredientCostDialog dialog={cost} item={item} />
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
});
