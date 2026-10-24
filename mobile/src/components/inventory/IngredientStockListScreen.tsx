import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IngredientCard, ingredientReorderText } from '@/components/ingredients/IngredientCard';
import { InventoryKindSwitch } from '@/components/inventory/InventoryKindSwitch';
import { averageCostText, INVENTORY_OFFLINE_MESSAGE, STOCK_STATUS_CHIP } from '@/components/inventory/inventoryLabels';
import { StockListBody, StockSummaryCards } from '@/components/inventory/StockListTable';
import type { GridEmptyProps } from '@/components/shared/CardGrid';
import { ListFilters, ListSearch } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { Chip } from '@/components/ui/Chip';
import { CellText, type DataTableColumn } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { ingredientStockRoute } from '@/constants/routes';
import { colors, spacing } from '@/constants/theme';
import { useIngredientStockListScreen } from '@/hooks/ingredients/useIngredientStock';
import type { InventorySegment } from '@/hooks/inventory/useInventory';
import { useResponsive } from '@/hooks/useResponsive';
import type { Ingredient, InventorySummary } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';
import { formatQty, friendlyQty } from '@pos/core/quantity';

function keyOf(ingredient: Ingredient): string {
  return String(ingredient.id);
}

function rowTestID(ingredient: Ingredient): string {
  return `ingredient-card-${ingredient.id}`;
}

function rowLabel(ingredient: Ingredient): string {
  const status = STOCK_STATUS_CHIP[ingredient.status];
  return `${ingredient.name}, ${formatQty(ingredient.qty)} ${ingredient.base_unit} on hand, ${status.label}, ${ingredientReorderText(ingredient)}, stock value ${formatPeso(
    ingredient.stock_value_cents,
  )}${ingredient.is_active ? '' : ', inactive'}`;
}

function openIngredient(ingredient: Ingredient) {
  router.push(ingredientStockRoute(ingredient.id));
}

function renderCard(ingredient: Ingredient) {
  return <IngredientCard ingredient={ingredient} variant="stock" onPress={openIngredient} />;
}

function withCount(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} (${formatCount(count)})`;
}

function segmentOptions(summary: InventorySummary | null, showAlerts: boolean): SegmentOption<InventorySegment>[] {
  const options: SegmentOption<InventorySegment>[] = [
    { value: 'all', label: 'All', testID: 'ingredient-stock-segment-all' },
    { value: 'low', label: withCount('Low', summary?.low), testID: 'ingredient-stock-segment-low' },
    { value: 'out', label: withCount('Out', summary?.out), testID: 'ingredient-stock-segment-out' },
  ];
  if (showAlerts) {
    const alerts = summary ? summary.low + summary.out : undefined;
    options.push({ value: 'alerts', label: withCount('Low & out', alerts), testID: 'ingredient-stock-segment-alerts' });
  }
  return options;
}

/**
 * The ingredients table (Sage "Inventory" board): ingredient (with
 * `Reorder at …` under it), on hand in the base unit (a friendlier unit under
 * it), average cost, value and status; tablet portrait drops the average cost.
 * Cells keep the card test IDs (`ingredient-card-<id>-qty`, `-friendly`,
 * `-reorder`, `-value`, `-status`, `-inactive`).
 */
function useIngredientColumns(wide: boolean): DataTableColumn<Ingredient>[] {
  return useMemo(() => {
    const name: DataTableColumn<Ingredient> = {
      key: 'ingredient',
      header: 'Ingredient',
      flex: 1.5,
      render: (ingredient) => (
        <>
          <CellText variant="strong">{ingredient.name}</CellText>
          <CellText variant="muted" testID={`${rowTestID(ingredient)}-reorder`}>
            {ingredientReorderText(ingredient)}
          </CellText>
        </>
      ),
    };
    const onHand: DataTableColumn<Ingredient> = {
      key: 'qty',
      header: 'On hand',
      flex: 1,
      align: 'right',
      render: (ingredient) => {
        const friendly = friendlyQty(ingredient.qty, ingredient.base_unit);
        return (
          <>
            <CellText
              variant="strong"
              align="right"
              style={ingredient.status === 'out' ? styles.out : undefined}
              testID={`${rowTestID(ingredient)}-qty`}
            >
              {`${formatQty(ingredient.qty)} ${ingredient.base_unit}`}
            </CellText>
            {friendly ? (
              <CellText variant="muted" align="right" testID={`${rowTestID(ingredient)}-friendly`}>
                {friendly}
              </CellText>
            ) : null}
          </>
        );
      },
    };
    const cost: DataTableColumn<Ingredient> = {
      key: 'cost',
      header: 'Avg cost',
      flex: 0.9,
      align: 'right',
      headerAccessibilityLabel: 'Average cost',
      render: (ingredient) => (
        <CellText align="right" style={styles.resting}>
          {averageCostText(ingredient)}
        </CellText>
      ),
    };
    const value: DataTableColumn<Ingredient> = {
      key: 'value',
      header: 'Value',
      flex: 0.9,
      align: 'right',
      render: (ingredient) => (
        <CellText align="right" testID={`${rowTestID(ingredient)}-value`}>
          {formatPeso(ingredient.stock_value_cents)}
        </CellText>
      ),
    };
    const statusColumn: DataTableColumn<Ingredient> = {
      key: 'status',
      header: 'Status',
      flex: 1.1,
      render: (ingredient) => {
        const chip = STOCK_STATUS_CHIP[ingredient.status];
        return (
          <View style={styles.chips}>
            <Chip label={chip.label} variant={chip.variant} testID={`${rowTestID(ingredient)}-status`} />
            {ingredient.is_active ? null : <Chip label="Inactive" testID={`${rowTestID(ingredient)}-inactive`} />}
          </View>
        );
      },
    };
    return wide ? [name, onHand, cost, value, statusColumn] : [name, onHand, value, statusColumn];
  }, [wide]);
}

/**
 * Inventory → Ingredients (`inventory.adjust` or `report.view`): the
 * branch's ingredients with their stock in the base unit (and a friendlier
 * unit), the average cost, the stock value, the status chip and the reorder
 * level. The summary cards, the pill search, the `All · Low · Out` filter
 * (plus `Low & out` from the dashboard), a table on tablets or the stock
 * cards on phones, every list state. Offline: `Inventory needs a connection.`
 */
export function IngredientStockListScreen() {
  const screen = useIngredientStockListScreen();
  const { isTablet, isLandscape } = useResponsive();
  const columns = useIngredientColumns(isTablet && isLandscape);
  const tracked = screen.summary?.tracked;
  const { clearFilters } = screen;

  const empty = useMemo<GridEmptyProps>(
    () =>
      screen.filtersActive
        ? {
            title: 'No matching ingredients',
            message: 'Try another name, or show every status.',
            icon: 'search-outline',
            actionLabel: 'Clear filters',
            onAction: clearFilters,
          }
        : { title: 'No ingredients yet', message: 'Ingredients added in Catalogue → Ingredients show here.', icon: 'nutrition-outline' },
    [screen.filtersActive, clearFilters],
  );

  return (
    <Screen edges={[]} testID="ingredient-stock-list-screen">
      <ListHeader
        band
        title="Inventory"
        subtitle={tracked === undefined ? undefined : `${formatCount(tracked)} ${tracked === 1 ? 'ingredient' : 'ingredients'}`}
        testIDPrefix="ingredient-stock"
        search={
          isTablet ? (
            <ListSearch
              search={screen.search}
              onSearchChange={screen.setSearch}
              searching={screen.searching}
              placeholder="Ingredient name"
              variant="searchSurface"
              testID="ingredient-stock-search"
            />
          ) : undefined
        }
      >
        <InventoryKindSwitch kind="ingredients" />
      </ListHeader>
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="ingredient-stock-toolbar">
        <ListFilters<InventorySegment>
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="Ingredient name"
          searchTestID="ingredient-stock-search"
          hideSearch={isTablet}
          segment={{
            options: segmentOptions(screen.summary, screen.showAlertsSegment),
            value: screen.segment,
            onChange: screen.setSegment,
            accessibilityLabel: 'Stock status',
            testID: 'ingredient-stock-segment',
          }}
        />
        </ListToolbar>
        {screen.online ? (
          <StockListBody
            items={screen.list.items}
            grid={screen.list.grid}
            columns={columns}
            keyExtractor={keyOf}
            onRowPress={openIngredient}
            rowTestID={rowTestID}
            rowAccessibilityLabel={rowLabel}
            rowAccessibilityHint="Opens the ingredient's stock and history"
            renderCard={renderCard}
            empty={empty}
            header={<StockSummaryCards summary={screen.summary} testIDPrefix="ingredient-stock" />}
            testID="ingredient-stock-grid"
          />
        ) : (
          <EmptyState
            title={INVENTORY_OFFLINE_MESSAGE}
            message="Stock levels and history load from the server. Connect this tablet and try again."
            icon="cloud-offline-outline"
            testID="ingredient-stock-offline"
          />
        )}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  out: {
    color: colors.dangerText,
  },
  resting: {
    color: colors.textResting,
  },
});
