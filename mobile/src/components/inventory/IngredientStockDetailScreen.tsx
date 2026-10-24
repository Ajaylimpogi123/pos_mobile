import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ingredientReorderText } from '@/components/ingredients/IngredientCard';
import { ingredientMovementView } from '@/components/inventory/IngredientMovementRow';
import { IngredientCostDialog, IngredientReorderDialog, IngredientStockDialog } from '@/components/inventory/IngredientStockDialogs';
import { averageCostText, INGREDIENT_MOVEMENT_TYPES, INVENTORY_OFFLINE_MESSAGE, STOCK_STATUS_CHIP } from '@/components/inventory/inventoryLabels';
import { MovementCard, movementColumns, movementTestID } from '@/components/inventory/MovementRow';
import { HistoryHeader, historyPagination, historyState, StockActions, StockSummary, type StockAction } from '@/components/inventory/StockDetailParts';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { Banner } from '@/components/ui/Banner';
import { DataTable } from '@/components/ui/DataTable';
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
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { NO_VALUE } from '@pos/core/numbers';
import { goBackOr } from '@/utils/navigation';
import { hasAnyPermission, PURCHASING_READ_PERMISSIONS } from '@/utils/permissions';
import { formatQty, friendlyQty } from '@pos/core/quantity';

function backToList() {
  goBackOr(ROUTES.inventoryIngredients);
}

function movementKey(movement: IngredientMovement): string {
  return movement.ulid;
}

function rowTestID(movement: IngredientMovement): string {
  return movementTestID(movement.ulid);
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
 * `inventory.adjust` or `report.view`), structured like the web stock page:
 * - the header: the name with its status badge, the base unit, the last
 *   movement, and **Adjust**, **Count**, **Wastage** and §D1 **Set cost**
 *   (outline; `inventory.adjust`), each with the unit picker; stock in comes
 *   from Receiving only;
 * - stat cards: On hand (base unit, a friendlier one under it; orange only
 *   when Low / Out), Avg cost, Stock value and the reorder level with **Edit**;
 * - the history, newest first, with the entered qty and unit, and links to
 *   the order or purchase order: a table in tablet landscape, cards in
 *   portrait and on phones, then "Showing n" and **Load more**. Pull-to-refresh.
 */
export function IngredientStockDetailScreen({ ingredientId }: { ingredientId: number | null }) {
  const itemQuery = useIngredientStockItem(ingredientId);
  const [typeFilter, setTypeFilter] = useState<IngredientMovementType | null>(null);
  const history = useIngredientMovements(ingredientId, typeFilter);
  const { canAdjust, canOpenOrders } = useInventoryPermissions();
  const canOpenPurchaseOrders = useSessionStore((state) => hasAnyPermission(state.user, PURCHASING_READ_PERMISSIONS));
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const online = useIsOnline();
  const { screenPaddingX, screenPaddingY, gutter, isTablet, contentMaxWidth } = useResponsive();
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
  const toView = useCallback(
    (movement: IngredientMovement) => ingredientMovementView(movement, { baseUnit, timeZone, onOpenOrder, onOpenPurchaseOrder }),
    [baseUnit, timeZone, onOpenOrder, onOpenPurchaseOrder],
  );
  const columns = useMemo(() => movementColumns(toView), [toView]);
  const renderCard = useCallback((movement: IngredientMovement) => <MovementCard {...toView(movement)} />, [toView]);

  const actions = useMemo<StockAction[]>(
    () => [
      { key: 'adjustment', title: 'Adjust', icon: 'swap-vertical-outline', variant: 'secondary', onPress: adjust.open, testID: 'ingredient-action-adjustment' },
      { key: 'count', title: 'Count', icon: 'clipboard-outline', variant: 'secondary', onPress: count.open, testID: 'ingredient-action-count' },
      { key: 'wastage', title: 'Wastage', icon: 'trash-outline', variant: 'secondary', onPress: wastage.open, testID: 'ingredient-action-wastage' },
      { key: 'cost', title: 'Set cost', icon: 'pricetag-outline', variant: 'secondary', onPress: cost.open, testID: 'ingredient-action-cost' },
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

  function loadMore() {
    if (history.hasNextPage && !history.isFetchingNextPage && !history.grid.nextPageError) history.grid.fetchNextPage();
  }

  const friendly = friendlyQty(item.qty, item.base_unit);

  const header = (
    <View style={{ gap: gutter }}>
      {online ? null : <Banner variant="warning" message={INVENTORY_OFFLINE_MESSAGE} testID="ingredient-detail-offline" />}
      {notice ? <Banner variant="success" message={notice} testID="ingredient-notice" /> : null}
      {itemQuery.isError ? <Banner variant="warning" message={getErrorMessage(itemQuery.error)} /> : null}
      <StockSummary
        name={item.name}
        caption={`Base unit: ${item.base_unit}`}
        status={STOCK_STATUS_CHIP[item.status]}
        stockStatus={item.status}
        lastMovement={item.last_movement_at ? (formatBranchDateTime(item.last_movement_at, timeZone) ?? item.last_movement_at) : null}
        actions={canAdjust ? <StockActions actions={actions} disabled={!online} testID="ingredient-actions" /> : null}
        stats={[
          {
            key: 'qty',
            label: 'On hand',
            value: `${formatQty(item.qty)} ${item.base_unit}`,
            icon: 'cube-outline',
            footnote: friendly ? `${friendly} on hand` : 'on hand',
            testID: 'ingredient-summary-qty',
            footnoteTestID: 'ingredient-summary-friendly',
          },
          { key: 'cost', label: 'Avg cost', value: averageCostText(item), icon: 'pricetag-outline', testID: 'ingredient-summary-cost' },
          { key: 'value', label: 'Stock value', value: formatPeso(item.stock_value_cents), icon: 'cash-outline', testID: 'ingredient-summary-value' },
          {
            key: 'reorder',
            label: 'Reorder level',
            value: item.reorder_level === null ? NO_VALUE : `${formatQty(item.reorder_level)} ${item.base_unit}`,
            icon: 'notifications-outline',
            footnote: ingredientReorderText(item),
            testID: 'ingredient-summary-reorder-level',
            footnoteTestID: 'ingredient-summary-reorder',
            action: canAdjust && online ? { title: 'Edit', onPress: reorder.open, testID: 'ingredient-reorder-edit' } : null,
          },
        ]}
        testID="ingredient-summary"
      />
      <HistoryHeader types={INGREDIENT_MOVEMENT_TYPES} value={typeFilter} onChange={setTypeFilter} testIDPrefix="ingredient-type" />
      {history.grid.updating ? <ActivityIndicator color={colors.primaryBright} /> : null}
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
    alignSelf: 'center',
  },
});
