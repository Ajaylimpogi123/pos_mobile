import { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { STOCK_STATUS_CHIP, reorderText } from '@/components/inventory/inventoryLabels';
import { ReportTotalCards, type ReportTotal } from '@/components/reports/ReportParts';
import { Chip } from '@/components/ui/Chip';
import { CellText, DATA_TABLE_ROW_HEIGHT, type DataTableColumn, type DataTableFooter } from '@/components/ui/DataTable';
import { colors, layout, spacing } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import type { InventoryReportRow, InventoryReportTotals } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

/**
 * The rows table's layout: every column (wide: tablet landscape), the key
 * movements (tablet portrait, phone landscape), or name, closing and status
 * (phone portrait).
 */
export type InventoryTableMode = 'full' | 'medium' | 'compact';

/** Every column where there is room; a phone in portrait shows name, closing qty and status. */
export function useInventoryTableMode(): InventoryTableMode {
  const { isPhone, isPortrait, isTablet, isLandscape } = useResponsive();
  if (isPhone && isPortrait) return 'compact';
  return isTablet && isLandscape ? 'full' : 'medium';
}

/** Inventory rows carry two lines in the status and value cells: 60 dp. */
export const INVENTORY_ROW_HEIGHT = DATA_TABLE_ROW_HEIGHT + spacing.sm;

/** The total cards: stock value (emphasised), tracked, low, out, received, sold, wasted. */
export const InventoryTotalsCard = memo(function InventoryTotalsCard({ totals }: { totals: InventoryReportTotals }) {
  const items = useMemo<ReportTotal[]>(
    () => [
      { key: 'value', label: 'Stock value', value: formatPeso(totals.stock_value_cents), testID: 'inventory-total-value', emphasis: true },
      { key: 'tracked', label: 'Tracked', value: formatCount(totals.tracked), testID: 'inventory-total-tracked' },
      { key: 'low', label: 'Low', value: formatCount(totals.low), testID: 'inventory-total-low' },
      { key: 'out', label: 'Out', value: formatCount(totals.out), testID: 'inventory-total-out' },
      { key: 'received', label: 'Received', value: formatCount(totals.received), testID: 'inventory-total-received' },
      { key: 'sold', label: 'Sold', value: formatCount(totals.sold), testID: 'inventory-total-sold' },
      { key: 'wasted', label: 'Wasted', value: formatCount(totals.wasted), testID: 'inventory-total-wasted' },
    ],
    [totals],
  );
  return <ReportTotalCards totals={items} testID="inventory-report-totals" />;
});

/** The quantity columns shown in each mode (label, spoken label, and the row field). */
type QtyField = 'opening_qty' | 'received' | 'sold' | 'returned' | 'wasted' | 'adjusted' | 'closing_qty';
const QTY_COLUMNS: readonly { field: QtyField; label: string; spoken: string; modes: readonly InventoryTableMode[] }[] = [
  { field: 'opening_qty', label: 'Open', spoken: 'Opening', modes: ['full'] },
  { field: 'received', label: 'In', spoken: 'Received', modes: ['full', 'medium'] },
  { field: 'sold', label: 'Sold', spoken: 'Sold', modes: ['full', 'medium'] },
  { field: 'returned', label: 'Ret.', spoken: 'Returned', modes: ['full'] },
  { field: 'wasted', label: 'Waste', spoken: 'Wasted', modes: ['full', 'medium'] },
  { field: 'adjusted', label: 'Adj.', spoken: 'Adjusted', modes: ['full'] },
  { field: 'closing_qty', label: 'Close', spoken: 'Closing', modes: ['full', 'medium', 'compact'] },
];

function testIDOf(row: InventoryReportRow): string {
  return `inventory-report-row-${row.product_id}`;
}

export const inventoryRowTestID = testIDOf;

/** What a screen reader says for one product of the report. */
export function inventoryRowAccessibilityLabel(row: InventoryReportRow): string {
  const status = STOCK_STATUS_CHIP[row.status];
  const spoken = QTY_COLUMNS.map((column) => `${column.spoken} ${formatCount(row[column.field])}`).join(', ');
  return `${row.name}, ${row.category_name}: ${spoken}, ${status.label}, ${reorderText(row.reorder_level)}, value ${formatPeso(row.stock_value_cents)}`;
}

/**
 * The rows table's columns. Landscape: every column (the category under the
 * name, the reorder level under the status, the unit cost under the value);
 * tablet portrait: received, sold, wasted and closing; phone portrait:
 * closing and status (the movements under the name).
 */
export function useInventoryColumns(mode: InventoryTableMode): DataTableColumn<InventoryReportRow>[] {
  return useMemo(() => {
    const compact = mode === 'compact';
    const columns: DataTableColumn<InventoryReportRow>[] = [
      {
        key: 'product',
        header: 'Product',
        flex: 1,
        render: (row) => (
          <>
            <CellText variant="strong" numberOfLines={compact ? 2 : 1}>
              {row.name}
            </CellText>
            <CellText variant="muted">{row.category_name}</CellText>
            {compact ? (
              <CellText variant="muted" numberOfLines={2}>
                {`In ${formatCount(row.received)} · Sold ${formatCount(row.sold)} · Wasted ${formatCount(row.wasted)}`}
              </CellText>
            ) : null}
          </>
        ),
      },
      ...QTY_COLUMNS.filter((column) => column.modes.includes(mode)).map<DataTableColumn<InventoryReportRow>>((column) => ({
        key: column.field,
        header: column.label,
        headerAccessibilityLabel: column.spoken,
        width: layout.inventoryQtyColumnWidth,
        align: 'right',
        render: (row) => (
          <CellText
            variant={column.field === 'closing_qty' ? 'strong' : 'default'}
            align="right"
            style={row[column.field] < 0 ? styles.negative : undefined}
            testID={`${testIDOf(row)}-${column.field}`}
          >
            {formatCount(row[column.field])}
          </CellText>
        ),
      })),
      {
        key: 'status',
        header: 'Status',
        width: layout.inventoryStatusColumnWidth,
        render: (row) => {
          const status = STOCK_STATUS_CHIP[row.status];
          return (
            <>
              <Chip label={status.label} variant={status.variant} testID={`${testIDOf(row)}-status`} />
              {compact ? null : <CellText variant="muted">{row.reorder_level === null ? 'No level' : `At ${formatCount(row.reorder_level)}`}</CellText>}
            </>
          );
        },
      },
    ];
    if (!compact) {
      columns.push({
        key: 'value',
        header: 'Value',
        width: layout.reportNumberColumnWidth,
        align: 'right',
        render: (row) => (
          <>
            <CellText variant="strong" align="right" testID={`${testIDOf(row)}-value`}>
              {formatPeso(row.stock_value_cents)}
            </CellText>
            <CellText variant="muted" align="right">
              @ {formatPeso(row.unit_cost_cents)}
            </CellText>
          </>
        ),
      });
    }
    return columns;
  }, [mode]);
}

/** The totals row: the movements the report sums, and the stock value. */
export function inventoryFooter(totals: InventoryReportTotals): DataTableFooter {
  return {
    product: 'Total',
    received: formatCount(totals.received),
    sold: formatCount(totals.sold),
    wasted: formatCount(totals.wasted),
    value: formatPeso(totals.stock_value_cents),
  };
}

const styles = StyleSheet.create({
  negative: {
    color: colors.dangerText,
  },
});
