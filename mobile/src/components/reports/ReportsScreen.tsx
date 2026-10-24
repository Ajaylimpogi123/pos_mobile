import { useCallback, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { IngredientReportView } from '@/components/reports/IngredientReportView';
import { InventoryReportView } from '@/components/reports/InventoryReportView';
import { useInventoryTableMode } from '@/components/reports/InventoryReportParts';
import { PurchasingReportView } from '@/components/reports/PurchasingReportView';
import { FilterChipRow, ReportFilters, SalesGroupByFilter } from '@/components/reports/ReportFilters';
import {
  dayCountLabel,
  ReportDayChart,
  reportContentStyle,
  ReportToolbar,
  ReportTotalsCard,
  salesFooter,
  salesRowAccessibilityLabel,
  useSalesColumns,
} from '@/components/reports/ReportParts';
import { ReportStatusCard } from '@/components/reports/ReportStatusCard';
import { ListHeader } from '@/components/shared/ListHeader';
import { Banner } from '@/components/ui/Banner';
import { DataTable } from '@/components/ui/DataTable';
import { Screen } from '@/components/ui/Screen';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { colors, layout } from '@/constants/theme';
import { useInventoryReport } from '@/hooks/reports/useInventoryReport';
import { useIngredientReport, usePurchasingReport } from '@/hooks/reports/usePurchasingReport';
import { useReportRange } from '@/hooks/reports/useReportRange';
import { useSalesReport, type SalesReportState } from '@/hooks/reports/useSalesReport';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { InventoryReportKind, SalesReportRow } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';

/** Contract: rows are capped at 500 (`meta.truncated`). */
export const TRUNCATED_MESSAGE = 'Showing the first 500 rows. Choose a shorter range to see every row.';

function rowKey(row: SalesReportRow): string {
  return row.key;
}

function rowTestID(row: SalesReportRow): string {
  return `report-row-${row.key}`;
}

export type ReportKind = 'sales' | 'inventory' | 'purchasing';

const REPORT_KINDS: readonly SegmentOption<ReportKind>[] = [
  { value: 'sales', label: 'Sales', icon: 'bar-chart-outline', testID: 'reports-kind-sales' },
  { value: 'inventory', label: 'Inventory', icon: 'cube-outline', testID: 'reports-kind-inventory' },
  { value: 'purchasing', label: 'Purchasing', icon: 'document-text-outline', testID: 'reports-kind-purchasing' },
];

const SUBTITLES: Record<ReportKind, string> = {
  sales: 'Completed sales in this branch',
  inventory: 'Stock movements in this branch',
  purchasing: 'Purchase requests, orders and receipts',
};

const INVENTORY_KINDS: readonly { value: InventoryReportKind; label: string }[] = [
  { value: 'products', label: 'Products' },
  { value: 'ingredients', label: 'Ingredients' },
];

/**
 * Reports (Sage "Reports" board): a `Sales | Inventory | Purchasing` switch
 * below the bar, over one shared date range (switching keeps it, and each
 * view keeps its own filters, all held here above the layout). Only the
 * visible view loads.
 * - Sales and Inventory need `report.view`; Purchasing `report.view` or
 *   `purchase.approve` (§I). Only the kinds the user may open are offered.
 * - Inventory has a `Products | Ingredients` kind (§D `kind`).
 */
export function ReportsScreen() {
  const canViewReports = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.reportView));
  const canViewPurchasing = useSessionStore((state) =>
    hasAnyPermission(state.user, [PERMISSIONS.reportView, PERMISSIONS.purchaseApprove]),
  );
  const kinds = REPORT_KINDS.filter((option) => (option.value === 'purchasing' ? canViewPurchasing : canViewReports));
  const [picked, setKind] = useState<ReportKind>(canViewReports ? 'sales' : 'purchasing');
  const kind = kinds.some((option) => option.value === picked) ? picked : (kinds[0]?.value ?? 'sales');
  const [inventoryKind, setInventoryKind] = useState<InventoryReportKind>('products');
  const range = useReportRange();
  const sales = useSalesReport(range, kind === 'sales');
  const inventory = useInventoryReport(range, kind === 'inventory' && inventoryKind === 'products');
  const ingredients = useIngredientReport(range, kind === 'inventory' && inventoryKind === 'ingredients');
  const purchasing = usePurchasingReport(range, kind === 'purchasing');

  const inventorySwitch = (
    <FilterChipRow label="Of" options={INVENTORY_KINDS} value={inventoryKind} onChange={setInventoryKind} testIDPrefix="inventory-report-kind" />
  );

  let view: ReactElement;
  if (kind === 'sales') view = <SalesReportView report={sales} />;
  else if (kind === 'purchasing') view = <PurchasingReportView report={purchasing} />;
  else if (inventoryKind === 'ingredients') view = <IngredientReportView report={ingredients} kindSwitch={inventorySwitch} />;
  else view = <InventoryReportView report={inventory} kindSwitch={inventorySwitch} />;

  return (
    <Screen edges={[]} testID="reports-screen">
      <ListHeader band subtitle={SUBTITLES[kind]} title="Reports" testIDPrefix="reports">
        {kinds.length > 1 ? (
          <SegmentedControl
            options={kinds}
            value={kind}
            onChange={setKind}
            accessibilityLabel="Report"
            style={styles.kinds}
            testID="reports-kind"
          />
        ) : null}
      </ListHeader>
      <SafeAreaView edges={['left', 'right']} style={styles.fill}>
        {view}
      </SafeAreaView>
    </Screen>
  );
}

/**
 * The Sales view: the date range and `group_by` pills, the summary and
 * **Export CSV**, the total cards (net sales emphasised), a chart for `day`,
 * then the rows table (virtualised, ≤ 500 rows) with a totals footer. Every
 * state: skeleton loading, error with Retry, empty ("No sales in this
 * range"), pull-to-refresh. The filters stay on screen in every state. A
 * centred column (max 1200) that re-lays out on rotation.
 */
function SalesReportView({ report }: { report: SalesReportState }) {
  const responsive = useResponsive();
  const mode = useInventoryTableMode();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const { query } = report;
  const result = query.data;
  const data = result?.report;
  // Voids & Refunds (Phase 7): a range with only refunds (of earlier sales) or voids still has figures to show.
  const hasSales =
    data !== undefined && (data.totals.orders_count > 0 || (data.totals.refunds_count ?? 0) > 0 || (data.totals.voids_count ?? 0) > 0);
  const groupBy = data?.group_by ?? report.groupBy;
  const columns = useSalesColumns(groupBy, mode);
  const toggleTable = useCallback(() => setShowTable((value) => !value), []);
  const rowLabel = useCallback((row: SalesReportRow) => salesRowAccessibilityLabel(row, groupBy), [groupBy]);

  async function refresh() {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  let status: ReactElement | null = null;
  if (query.isPending) status = <ReportStatusCard kind="loading" testID="report-loading" />;
  else if (query.isError && !data) status = <ReportStatusCard kind="error" error={query.error} onRetry={() => void query.refetch()} testID="report-error" retryTestID="report-retry" />;
  else if (data && !hasSales) {
    status = (
      <ReportStatusCard
        kind="empty"
        icon="bar-chart-outline"
        title="No sales in this range"
        message="Completed sales show here. Try a longer range."
        testID="report-empty"
      />
    );
  }

  const header = (
    <View style={{ gap: responsive.gutter }}>
      <ReportFilters range={report}>
        <SalesGroupByFilter report={report} />
      </ReportFilters>
      <ReportToolbar
        summary={dayCountLabel(report.dayCount)}
        summaryTestID="report-summary"
        onExport={report.exportCsv}
        exporting={report.exporting}
        disabled={!hasSales}
        exportTestID="report-export"
      />
      {report.exportMessage ? <Banner variant={report.exportMessage.variant} message={report.exportMessage.text} testID="report-export-message" /> : null}
      {report.updating ? <ActivityIndicator color={colors.primaryBright} testID="report-updating" /> : null}
      {query.isError && data ? <Banner variant="warning" message={getErrorMessage(query.error)} testID="report-refresh-error" /> : null}
      {status}
      {data && hasSales ? (
        <>
          {result?.truncated ? <Banner variant="info" message={TRUNCATED_MESSAGE} testID="report-truncated" /> : null}
          <ReportTotalsCard totals={data.totals} />
          {data.group_by === 'day' ? <ReportDayChart rows={data.rows} showTable={showTable} onToggleTable={toggleTable} /> : null}
        </>
      ) : null}
    </View>
  );

  return (
    <DataTable
      columns={columns}
      rows={data && hasSales ? data.rows : []}
      keyExtractor={rowKey}
      rowTestID={rowTestID}
      rowAccessibilityLabel={rowLabel}
      footer={data && hasSales ? salesFooter(data.totals) : null}
      loading={query.isPending}
      rowHeight={mode === 'compact' ? 'auto' : undefined}
      ListHeaderComponent={header}
      contentContainerStyle={reportContentStyle(responsive, insets.bottom)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
      }
      testID="report-list"
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  kinds: {
    width: '100%',
    maxWidth: layout.segmentedMaxWidth,
  },
});
