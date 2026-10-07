import { useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  INVENTORY_ROW_HEIGHT,
  InventoryTotalsCard,
  inventoryFooter,
  inventoryRowAccessibilityLabel,
  inventoryRowTestID,
  useInventoryColumns,
  useInventoryTableMode,
} from '@/components/reports/InventoryReportParts';
import { FilterChipRow, ReportFilters } from '@/components/reports/ReportFilters';
import { dayCountLabel, reportContentStyle, ReportToolbar } from '@/components/reports/ReportParts';
import { ReportStatusCard } from '@/components/reports/ReportStatusCard';
import { Banner } from '@/components/ui/Banner';
import { DataTable } from '@/components/ui/DataTable';
import { colors } from '@/constants/theme';
import { INVENTORY_STATUS_OPTIONS, type InventoryReportState } from '@/hooks/reports/useInventoryReport';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { InventoryReportRow } from '@/services/types';

/** Contract: rows are capped at 500 (`meta.truncated`). */
export const INVENTORY_TRUNCATED_MESSAGE = 'Showing the first 500 products. Choose a category or a status to see every row.';

/** The "every category" chip's value (the chip row needs a non-null value). */
const ALL_CATEGORIES = 0;

function rowKey(row: InventoryReportRow): string {
  return String(row.product_id);
}

/**
 * The Inventory view of Reports (`report.view`): the shared date range, the
 * category and status filters, the summary and **Export CSV**
 * (`Export inventory report`), the total cards (stock value emphasised), and
 * the rows table (every column on wide screens; name, closing qty and status
 * on phone portrait) with a totals footer, and the truncated banner. Every
 * state: skeleton loading, error with Retry, empty, pull-to-refresh.
 */
export function InventoryReportView({ report, kindSwitch }: { report: InventoryReportState; kindSwitch?: ReactNode }) {
  const responsive = useResponsive();
  const mode = useInventoryTableMode();
  const columns = useInventoryColumns(mode);
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const { query } = report;
  const result = query.data;
  const data = result?.report;
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
  if (query.isPending) status = <ReportStatusCard kind="loading" testID="inventory-report-loading" />;
  else if (query.isError && !data) {
    status = <ReportStatusCard kind="error" error={query.error} onRetry={() => void query.refetch()} testID="inventory-report-error" retryTestID="inventory-report-retry" />;
  } else if (data && !hasRows) {
    status = (
      <ReportStatusCard
        kind="empty"
        icon="cube-outline"
        title={report.filtersActive ? 'No products match these filters' : 'No tracked products'}
        message={report.filtersActive ? 'Try another category or status.' : 'Products with “Track stock” turned on in Menu show here.'}
        actionLabel={report.filtersActive ? 'Clear filters' : undefined}
        onAction={report.filtersActive ? report.clearFilters : undefined}
        testID="inventory-report-empty"
        actionTestID="inventory-report-clear"
      />
    );
  }

  const categoryOptions = [{ value: ALL_CATEGORIES, label: 'All categories' }, ...report.categories.map((chip) => ({ value: chip.id, label: chip.label }))];

  const header = (
    <View style={{ gap: responsive.gutter }}>
      <ReportFilters range={report.range}>
        {kindSwitch}
        <FilterChipRow
          label="Category"
          options={categoryOptions}
          value={report.categoryId ?? ALL_CATEGORIES}
          onChange={(id) => report.setCategoryId(id === ALL_CATEGORIES ? null : id)}
          testIDPrefix="inventory-report-category"
          scroll
        />
        <FilterChipRow
          label="Status"
          options={INVENTORY_STATUS_OPTIONS}
          value={report.status}
          onChange={report.setStatus}
          testIDPrefix="inventory-report-status"
        />
      </ReportFilters>
      <ReportToolbar
        summary={`${dayCountLabel(report.range.dayCount)}${data ? ` · ${data.rows.length} ${data.rows.length === 1 ? 'product' : 'products'}` : ''}`}
        summaryTestID="inventory-report-summary"
        onExport={report.exportCsv}
        exporting={report.exporting}
        disabled={!data}
        exportTestID="inventory-report-export"
      />
      {report.exportMessage ? (
        <Banner variant={report.exportMessage.variant} message={report.exportMessage.text} testID="inventory-report-export-message" />
      ) : null}
      {report.updating ? <ActivityIndicator color={colors.primaryBright} testID="inventory-report-updating" /> : null}
      {query.isError && data ? <Banner variant="warning" message={getErrorMessage(query.error)} testID="inventory-report-refresh-error" /> : null}
      {data ? <InventoryTotalsCard totals={data.totals} /> : null}
      {status}
      {hasRows && result?.truncated ? <Banner variant="info" message={INVENTORY_TRUNCATED_MESSAGE} testID="inventory-report-truncated" /> : null}
    </View>
  );

  return (
    <DataTable
      columns={columns}
      rows={hasRows ? data.rows : []}
      keyExtractor={rowKey}
      rowTestID={inventoryRowTestID}
      rowAccessibilityLabel={inventoryRowAccessibilityLabel}
      footer={hasRows ? inventoryFooter(data.totals) : null}
      loading={query.isPending}
      rowHeight={mode === 'compact' ? 'auto' : INVENTORY_ROW_HEIGHT}
      ListHeaderComponent={header}
      contentContainerStyle={reportContentStyle(responsive, insets.bottom)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
      }
      testID="inventory-report-list"
    />
  );
}
