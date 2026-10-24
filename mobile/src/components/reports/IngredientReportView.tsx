import { memo, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { STOCK_STATUS_CHIP } from '@/components/inventory/inventoryLabels';
import { useInventoryTableMode, type InventoryTableMode } from '@/components/reports/InventoryReportParts';
import { FilterChipRow, ReportFilters } from '@/components/reports/ReportFilters';
import { dayCountLabel, reportContentStyle, ReportToolbar, ReportTotalCards, type ReportTotal } from '@/components/reports/ReportParts';
import { ReportStatusCard } from '@/components/reports/ReportStatusCard';
import { Banner } from '@/components/ui/Banner';
import { Chip } from '@/components/ui/Chip';
import { CellText, DataTable, type DataTableColumn, type DataTableFooter } from '@/components/ui/DataTable';
import { colors, layout } from '@/constants/theme';
import { INVENTORY_STATUS_OPTIONS } from '@/hooks/reports/useInventoryReport';
import type { IngredientReportState } from '@/hooks/reports/usePurchasingReport';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { IngredientReportRow, IngredientReportTotals } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';
import { formatQty, isQtyAtOrBelowZero } from '@pos/core/quantity';

export const INGREDIENT_TRUNCATED_MESSAGE = 'Showing the first 500 ingredients. Choose a status to see every row.';

/** The flow columns (base units) shown per layout mode. */
type QtyField = 'opening_qty' | 'received' | 'used' | 'returned' | 'wasted' | 'adjusted' | 'closing_qty';
const COLUMNS: readonly { field: QtyField; label: string; spoken: string; modes: readonly InventoryTableMode[] }[] = [
  { field: 'opening_qty', label: 'Open', spoken: 'Opening', modes: ['full'] },
  { field: 'received', label: 'In', spoken: 'Received', modes: ['full', 'medium'] },
  { field: 'used', label: 'Used', spoken: 'Used', modes: ['full', 'medium'] },
  { field: 'returned', label: 'Ret.', spoken: 'Returned', modes: ['full'] },
  { field: 'wasted', label: 'Waste', spoken: 'Wasted', modes: ['full', 'medium'] },
  { field: 'adjusted', label: 'Adj.', spoken: 'Adjusted', modes: ['full'] },
  { field: 'closing_qty', label: 'Close', spoken: 'Closing', modes: ['full', 'medium', 'compact'] },
];

function rowKey(row: IngredientReportRow): string {
  return String(row.ingredient_id);
}

function testIDOf(row: IngredientReportRow): string {
  return `ingredient-report-row-${row.ingredient_id}`;
}

function rowLabel(row: IngredientReportRow): string {
  const spoken = COLUMNS.map((column) => `${column.spoken} ${formatQty(row[column.field])} ${row.base_unit}`).join(', ');
  return `${row.name}: ${spoken}, ${STOCK_STATUS_CHIP[row.status].label}, value ${formatPeso(row.stock_value_cents)}`;
}

/** Only the totals the server sent (Q-028: tracked, low, out, stock value, value in and out). */
const IngredientTotalsCard = memo(function IngredientTotalsCard({ totals }: { totals: IngredientReportTotals }) {
  const items = useMemo(() => {
    const list: ReportTotal[] = [];
    if (totals.stock_value_cents !== undefined) {
      list.push({ key: 'value', label: 'Stock value', value: formatPeso(totals.stock_value_cents), testID: 'ingredient-total-value', emphasis: true });
    }
    if (totals.tracked !== undefined) list.push({ key: 'tracked', label: 'Ingredients', value: formatCount(totals.tracked), testID: 'ingredient-total-tracked' });
    if (totals.low !== undefined) list.push({ key: 'low', label: 'Low', value: formatCount(totals.low), testID: 'ingredient-total-low' });
    if (totals.out !== undefined) list.push({ key: 'out', label: 'Out', value: formatCount(totals.out), testID: 'ingredient-total-out' });
    if (totals.value_in_cents !== undefined) list.push({ key: 'in', label: 'Value in', value: formatPeso(totals.value_in_cents), testID: 'ingredient-total-in' });
    if (totals.value_out_cents !== undefined) {
      list.push({ key: 'out-value', label: 'Value out', value: formatPeso(totals.value_out_cents), testID: 'ingredient-total-out-value' });
    }
    return list;
  }, [totals]);
  if (items.length === 0) return null;
  return <ReportTotalCards totals={items} testID="ingredient-report-totals" />;
});

/** The rows table's columns: name (and base unit), the flow columns for the mode, status and value. */
function useIngredientColumns(mode: InventoryTableMode): DataTableColumn<IngredientReportRow>[] {
  return useMemo(() => {
    const compact = mode === 'compact';
    const columns: DataTableColumn<IngredientReportRow>[] = [
      {
        key: 'name',
        header: 'Ingredient',
        flex: 1,
        render: (row) => (
          <>
            <CellText variant="strong" numberOfLines={compact ? 2 : 1}>
              {row.name}
            </CellText>
            <CellText variant="muted">In {row.base_unit}</CellText>
            {compact ? (
              <CellText variant="muted" numberOfLines={2}>
                {`In ${formatQty(row.received)} · Used ${formatQty(row.used)} · Wasted ${formatQty(row.wasted)}`}
              </CellText>
            ) : null}
          </>
        ),
      },
      ...COLUMNS.filter((column) => column.modes.includes(mode)).map<DataTableColumn<IngredientReportRow>>((column) => ({
        key: column.field,
        header: column.label,
        headerAccessibilityLabel: column.spoken,
        width: layout.reportCountColumnWidth,
        align: 'right',
        render: (row) => (
          <CellText
            variant={column.field === 'closing_qty' ? 'strong' : 'default'}
            align="right"
            style={column.field === 'closing_qty' && isQtyAtOrBelowZero(row.closing_qty) ? styles.negative : undefined}
            testID={`${testIDOf(row)}-${column.field}`}
          >
            {formatQty(row[column.field])}
          </CellText>
        ),
      })),
      {
        key: 'status',
        header: 'Status',
        width: layout.inventoryStatusColumnWidth,
        render: (row) => {
          const status = STOCK_STATUS_CHIP[row.status];
          return <Chip label={status.label} variant={status.variant} testID={`${testIDOf(row)}-status`} />;
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
          <CellText variant="strong" align="right" testID={`${testIDOf(row)}-value`}>
            {formatPeso(row.stock_value_cents)}
          </CellText>
        ),
      });
    }
    return columns;
  }, [mode]);
}

function ingredientFooter(totals: IngredientReportTotals): DataTableFooter | null {
  if (totals.stock_value_cents === undefined) return null;
  return { name: 'Total', value: formatPeso(totals.stock_value_cents) };
}

/**
 * The inventory report's **Ingredients** kind (§D `kind=ingredients`): the
 * shared range, the kind switch, a status filter, the summary and **Export
 * CSV** (with the kind), the total cards, and the rows table (opening,
 * received, used, returned, wasted, adjusted, closing in base units) with the
 * stock value in its footer. Every report state.
 */
export function IngredientReportView({ report, kindSwitch }: { report: IngredientReportState; kindSwitch: ReactNode }) {
  const responsive = useResponsive();
  const mode = useInventoryTableMode();
  const columns = useIngredientColumns(mode);
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const { query } = report;
  const data = query.data?.report;
  const hasRows = data !== undefined && data.rows.length > 0;

  async function refresh() {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  let status: ReactElement | null = null;
  if (query.isPending) status = <ReportStatusCard kind="loading" testID="ingredient-report-loading" />;
  else if (query.isError && !data) status = <ReportStatusCard kind="error" error={query.error} onRetry={() => void query.refetch()} testID="ingredient-report-error" />;
  else if (data && !hasRows) {
    status = (
      <ReportStatusCard
        kind="empty"
        icon="nutrition-outline"
        title={report.filtersActive ? 'No ingredients match this status' : 'No ingredients yet'}
        message={report.filtersActive ? 'Try another status.' : 'Ingredients added in Catalogue show here.'}
        actionLabel={report.filtersActive ? 'Clear filters' : undefined}
        onAction={report.filtersActive ? report.clearFilters : undefined}
        testID="ingredient-report-empty"
      />
    );
  }

  const header = (
    <View style={{ gap: responsive.gutter }}>
      <ReportFilters range={report.range}>
        {kindSwitch}
        <FilterChipRow label="Status" options={INVENTORY_STATUS_OPTIONS} value={report.status} onChange={report.setStatus} testIDPrefix="ingredient-report-status" />
      </ReportFilters>
      <ReportToolbar
        summary={`${dayCountLabel(report.range.dayCount)}${data ? ` · ${data.rows.length} ${data.rows.length === 1 ? 'ingredient' : 'ingredients'}` : ''}`}
        summaryTestID="ingredient-report-summary"
        onExport={report.exportCsv}
        exporting={report.exporting}
        disabled={!data}
        exportTestID="ingredient-report-export"
      />
      {report.exportMessage ? <Banner variant={report.exportMessage.variant} message={report.exportMessage.text} testID="ingredient-report-export-message" /> : null}
      {report.updating ? <ActivityIndicator color={colors.primaryBright} /> : null}
      {query.isError && data ? <Banner variant="warning" message={getErrorMessage(query.error)} /> : null}
      {data ? <IngredientTotalsCard totals={data.totals} /> : null}
      {status}
      {hasRows && query.data?.truncated ? <Banner variant="info" message={INGREDIENT_TRUNCATED_MESSAGE} testID="ingredient-report-truncated" /> : null}
    </View>
  );

  return (
    <DataTable
      columns={columns}
      rows={hasRows ? data.rows : []}
      keyExtractor={rowKey}
      rowTestID={testIDOf}
      rowAccessibilityLabel={rowLabel}
      footer={hasRows ? ingredientFooter(data.totals) : null}
      loading={query.isPending}
      rowHeight={mode === 'compact' ? 'auto' : undefined}
      ListHeaderComponent={header}
      contentContainerStyle={reportContentStyle(responsive, insets.bottom)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
      }
      testID="ingredient-report-list"
    />
  );
}

const styles = StyleSheet.create({
  negative: {
    color: colors.dangerText,
  },
});
