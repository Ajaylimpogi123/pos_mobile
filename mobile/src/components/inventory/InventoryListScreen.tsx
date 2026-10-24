import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InventoryCard } from '@/components/inventory/InventoryCard';
import { InventoryKindSwitch } from '@/components/inventory/InventoryKindSwitch';
import { INVENTORY_OFFLINE_MESSAGE, reorderText, STOCK_STATUS_CHIP } from '@/components/inventory/inventoryLabels';
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
import { inventoryItemRoute } from '@/constants/routes';
import { colors, spacing } from '@/constants/theme';
import { useInventoryListScreen, type InventorySegment } from '@/hooks/inventory/useInventory';
import { useResponsive } from '@/hooks/useResponsive';
import type { InventoryItem, InventorySummary } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

function itemKey(item: InventoryItem): string {
  return String(item.product_id);
}

function rowTestID(item: InventoryItem): string {
  return `inventory-card-${item.product_id}`;
}

function rowLabel(item: InventoryItem): string {
  const status = STOCK_STATUS_CHIP[item.status];
  return `${item.name}, ${formatCount(item.qty)} on hand, ${status.label}, ${reorderText(item.reorder_level)}, stock value ${formatPeso(item.stock_value_cents)}${
    item.is_available ? '' : ', unavailable'
  }`;
}

/** The detail shows this row (from the list's cache) as placeholder data while it loads the fresh one. */
function openItem(item: InventoryItem) {
  router.push(inventoryItemRoute(item.product_id));
}

function renderCard(item: InventoryItem) {
  return <InventoryCard item={item} onPress={openItem} />;
}

function withCount(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} (${formatCount(count)})`;
}

/** `All · Low (3) · Out (1)`, plus `Low & out (4)` once the dashboard opened it. */
function segmentOptions(summary: InventorySummary | null, showAlerts: boolean): SegmentOption<InventorySegment>[] {
  const options: SegmentOption<InventorySegment>[] = [
    { value: 'all', label: 'All', testID: 'inventory-segment-all' },
    { value: 'low', label: withCount('Low', summary?.low), testID: 'inventory-segment-low' },
    { value: 'out', label: withCount('Out', summary?.out), testID: 'inventory-segment-out' },
  ];
  if (showAlerts) {
    const alerts = summary ? summary.low + summary.out : undefined;
    options.push({ value: 'alerts', label: withCount('Low & out', alerts), testID: 'inventory-segment-alerts' });
  }
  return options;
}

/**
 * The products table (Sage "Inventory" board). Tablet landscape: product
 * (with `Reorder at …` under it), category, on hand, cost, value and status;
 * tablet portrait drops category and cost. Cells keep the card test IDs
 * (`inventory-card-<id>-qty`, `-status`, `-reorder`, `-value`, `-unavailable`).
 */
function useProductColumns(wide: boolean): DataTableColumn<InventoryItem>[] {
  return useMemo(() => {
    const product: DataTableColumn<InventoryItem> = {
      key: 'product',
      header: 'Product',
      flex: 1.6,
      render: (item) => (
        <>
          <CellText variant="strong">{item.name}</CellText>
          <CellText variant="muted" testID={`${rowTestID(item)}-reorder`}>
            {reorderText(item.reorder_level)}
          </CellText>
        </>
      ),
    };
    const category: DataTableColumn<InventoryItem> = {
      key: 'category',
      header: 'Category',
      flex: 1,
      render: (item) => (
        <>
          <CellText>{item.category.name}</CellText>
          {item.sku ? <CellText variant="muted">{item.sku}</CellText> : null}
        </>
      ),
    };
    const onHand: DataTableColumn<InventoryItem> = {
      key: 'qty',
      header: 'On hand',
      flex: 0.8,
      align: 'right',
      render: (item) => (
        <CellText variant="strong" align="right" style={item.qty <= 0 ? styles.out : undefined} testID={`${rowTestID(item)}-qty`}>
          {formatCount(item.qty)}
        </CellText>
      ),
    };
    const cost: DataTableColumn<InventoryItem> = {
      key: 'cost',
      header: 'Cost',
      flex: 0.8,
      align: 'right',
      render: (item) => <CellText align="right">{formatPeso(item.cost_cents)}</CellText>,
    };
    const value: DataTableColumn<InventoryItem> = {
      key: 'value',
      header: 'Value',
      flex: 0.9,
      align: 'right',
      render: (item) => (
        <CellText align="right" testID={`${rowTestID(item)}-value`}>
          {formatPeso(item.stock_value_cents)}
        </CellText>
      ),
    };
    const statusColumn: DataTableColumn<InventoryItem> = {
      key: 'status',
      header: 'Status',
      flex: 1.2,
      render: (item) => {
        const chip = STOCK_STATUS_CHIP[item.status];
        return (
          <View style={styles.chips}>
            <Chip label={chip.label} variant={chip.variant} testID={`${rowTestID(item)}-status`} />
            {item.is_available ? null : <Chip label="Unavailable" testID={`${rowTestID(item)}-unavailable`} />}
          </View>
        );
      },
    };
    return wide ? [product, category, onHand, cost, value, statusColumn] : [product, onHand, value, statusColumn];
  }, [wide]);
}

/**
 * Inventory (`inventory.adjust` or `report.view`): the branch's tracked
 * products with their stock.
 * - Header "Inventory" with the `Products | Ingredients` switch; subtitle
 *   `24 tracked products` (from `meta.summary`).
 * - Filters: the pill search (300 ms debounce), the segmented
 *   `All · Low (3) · Out (1)` (plus `Low & out` from the dashboard's alerts), category chips.
 * - The summary cards (Tracked · Low stock · Out of stock), then a table on
 *   tablets or the stock cards on phones, with every list state; a row opens
 *   the product. Offline: `Inventory needs a connection.`
 */
export function InventoryListScreen() {
  const screen = useInventoryListScreen();
  const { isTablet, isLandscape } = useResponsive();
  const columns = useProductColumns(isTablet && isLandscape);
  const tracked = screen.summary?.tracked;
  const { clearFilters } = screen;

  const empty = useMemo<GridEmptyProps>(
    () =>
      screen.filtersActive
        ? {
            title: 'No matching products',
            message: 'Try another name or SKU, another category, or show every status.',
            icon: 'search-outline',
            actionLabel: 'Clear filters',
            onAction: clearFilters,
          }
        : { title: 'No tracked products', message: 'Products with “Track stock” turned on in Menu show here.', icon: 'cube-outline' },
    [screen.filtersActive, clearFilters],
  );

  return (
    <Screen edges={[]} testID="inventory-list-screen">
      <ListHeader
        band
        title="Inventory"
        subtitle={tracked === undefined ? undefined : `${formatCount(tracked)} tracked ${tracked === 1 ? 'product' : 'products'}`}
        testIDPrefix="inventory"
        search={
          isTablet ? (
            <ListSearch
              search={screen.search}
              onSearchChange={screen.setSearch}
              searching={screen.searching}
              placeholder="Name or SKU"
              variant="searchSurface"
              testID="inventory-search"
            />
          ) : undefined
        }
      >
        <InventoryKindSwitch kind="products" />
      </ListHeader>
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="inventory-toolbar">
        <ListFilters<InventorySegment>
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="Name or SKU"
          searchTestID="inventory-search"
          hideSearch={isTablet}
          segment={{
            options: segmentOptions(screen.summary, screen.showAlertsSegment),
            value: screen.segment,
            onChange: screen.setSegment,
            accessibilityLabel: 'Stock status',
            testID: 'inventory-segment',
          }}
          chips={{
            items: screen.categories,
            selectedId: screen.categoryId,
            onChange: screen.setCategoryId,
            allLabel: 'All categories',
            testIDPrefix: 'inventory-category',
          }}
        />
        </ListToolbar>
        {screen.online ? (
          <StockListBody
            items={screen.list.items}
            grid={screen.list.grid}
            columns={columns}
            keyExtractor={itemKey}
            onRowPress={openItem}
            rowTestID={rowTestID}
            rowAccessibilityLabel={rowLabel}
            rowAccessibilityHint="Opens the product's stock and history"
            renderCard={renderCard}
            empty={empty}
            header={<StockSummaryCards summary={screen.summary} testIDPrefix="inventory" />}
            testID="inventory-grid"
          />
        ) : (
          <EmptyState
            title={INVENTORY_OFFLINE_MESSAGE}
            message="Stock levels and history load from the server. Connect this tablet and try again."
            icon="cloud-offline-outline"
            testID="inventory-offline"
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
});
