import { memo, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chipFor, DECISION, LINE_STATUS, PO_STATUS } from '@/components/purchasing/purchasingLabels';
import { useInventoryTableMode, type InventoryTableMode } from '@/components/reports/InventoryReportParts';
import { FilterChipRow, ReportFilters } from '@/components/reports/ReportFilters';
import { dayCountLabel, reportContentStyle, ReportToolbar, ReportTotalCards, type ReportTotal } from '@/components/reports/ReportParts';
import { ReportStatusCard } from '@/components/reports/ReportStatusCard';
import { Banner } from '@/components/ui/Banner';
import { Chip } from '@/components/ui/Chip';
import { CellText, DataTable, type DataTableColumn, type DataTableFooter } from '@/components/ui/DataTable';
import { colors, layout } from '@/constants/theme';
import {
  DECISION_OPTIONS,
  LINE_STATUS_OPTIONS,
  PO_STATUS_OPTIONS,
  PR_STATUS_OPTIONS,
  type PurchasingReportState,
} from '@/hooks/reports/usePurchasingReport';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { PurchasingReportRow, PurchasingReportTotals } from '@/services/types';
import { formatBusinessDate } from '@/utils/dates';
import { formatPeso } from '@pos/core/money';
import { formatCount, NO_VALUE } from '@pos/core/numbers';
import { formatQtyUnit } from '@pos/core/quantity';

export const PURCHASING_TRUNCATED_MESSAGE = 'Showing the first 500 items. Choose a shorter range or a filter to see every row.';

/** The total cards: the ordered money (emphasised), received and remaining, PRs, items and their decisions, and POs by status. */
const PurchasingTotalsCard = memo(function PurchasingTotalsCard({ totals }: { totals: PurchasingReportTotals }) {
  const items = useMemo<ReportTotal[]>(() => {
    const pos = totals.pos ?? {};
    return [
      { key: 'ordered', label: 'Ordered', value: formatPeso(totals.ordered_cents), testID: 'purchasing-total-ordered', emphasis: true },
      { key: 'received', label: 'Received', value: formatPeso(totals.received_cents), testID: 'purchasing-total-received' },
      { key: 'remaining', label: 'Remaining', value: formatPeso(totals.remaining_cents), testID: 'purchasing-total-remaining' },
      { key: 'prs', label: 'Requests', value: formatCount(totals.prs), testID: 'purchasing-total-prs' },
      { key: 'items', label: 'Items', value: formatCount(totals.items), testID: 'purchasing-total-items' },
      { key: 'approved', label: 'Approved', value: formatCount(totals.approved), testID: 'purchasing-total-approved' },
      { key: 'declined', label: 'Declined', value: formatCount(totals.declined), testID: 'purchasing-total-declined' },
      { key: 'pending', label: 'Pending', value: formatCount(totals.pending), testID: 'purchasing-total-pending' },
      ...(Object.keys(PO_STATUS) as (keyof typeof PO_STATUS)[]).map((status) => ({
        key: `pos-${status}`,
        label: `POs ${PO_STATUS[status].label}`,
        value: formatCount(pos[status] ?? 0),
        testID: `purchasing-total-pos-${status}`,
      })),
    ];
  }, [totals]);
  return <ReportTotalCards totals={items} testID="purchasing-report-totals" />;
});

function money(cents: number | null): string {
  return cents === null ? NO_VALUE : formatPeso(cents);
}

function qty(value: string | number | null, unit: string): string {
  return value === null ? NO_VALUE : formatQtyUnit(value, unit);
}

/** Rows are keyed by position (a PR item can repeat its PR number), so row test IDs use the index too. */
type IndexedRow = { row: PurchasingReportRow; index: number };

function rowKey(entry: IndexedRow): string {
  return `${entry.row.pr_no}-${entry.index}`;
}

function testIDOf(entry: IndexedRow): string {
  return `purchasing-report-row-${entry.index}`;
}

function rowLabel({ row }: IndexedRow): string {
  const decision = chipFor(DECISION, row.decision);
  return `${row.item_name} from ${row.supplier_name}, ${row.pr_no}, ${formatQtyUnit(row.requested_qty, row.unit)}, ${decision.label}${
    row.po_no ? `, ${row.po_no}` : ''
  }, received ${qty(row.received_qty, row.unit)}, ${money(row.received_cents)}`;
}

/** The rows table's columns: every column on wide screens; the item, decision and received money on phones. */
function usePurchasingColumns(mode: InventoryTableMode): DataTableColumn<IndexedRow>[] {
  return useMemo(() => {
    const full = mode === 'full';
    const compact = mode === 'compact';
    const columns: (DataTableColumn<IndexedRow> | null)[] = [
      {
        key: 'item',
        header: 'Item',
        flex: 1,
        render: ({ row }) => (
          <>
            <CellText variant="strong" numberOfLines={2}>
              {row.item_name}
            </CellText>
            <CellText variant="muted">{`${row.supplier_name} · ${formatQtyUnit(row.requested_qty, row.unit)}`}</CellText>
            {full ? null : <CellText variant="muted">{`${row.pr_no} · ${formatBusinessDate(row.pr_date)}`}</CellText>}
            {compact && row.po_no ? (
              <CellText variant="muted">{`${row.po_no} · ${qty(row.received_qty, row.unit)} of ${qty(row.ordered_qty, row.unit)}`}</CellText>
            ) : null}
          </>
        ),
      },
      full
        ? {
            key: 'request',
            header: 'Request',
            width: layout.reportTextColumnWidth,
            render: ({ row }) => (
              <>
                <CellText>{row.pr_no}</CellText>
                <CellText variant="muted">{`${formatBusinessDate(row.pr_date)} · ${row.requested_by}`}</CellText>
              </>
            ),
          }
        : null,
      {
        key: 'decision',
        header: 'Decision',
        width: layout.inventoryStatusColumnWidth,
        render: (entry) => {
          const decision = chipFor(DECISION, entry.row.decision);
          return (
            <>
              <Chip label={decision.label} variant={decision.variant} testID={`${testIDOf(entry)}-decision`} />
              {entry.row.decision_reason ? (
                <CellText variant="muted" numberOfLines={2}>
                  {entry.row.decision_reason}
                </CellText>
              ) : null}
            </>
          );
        },
      },
      compact
        ? null
        : {
            key: 'order',
            header: 'Order',
            width: layout.reportTextColumnWidth,
            render: (entry) => {
              const po = entry.row.po_status ? chipFor(PO_STATUS, entry.row.po_status) : null;
              return (
                <>
                  <CellText testID={`${testIDOf(entry)}-po`}>{entry.row.po_no ?? NO_VALUE}</CellText>
                  {po ? <CellText variant="muted">{po.label}</CellText> : null}
                </>
              );
            },
          },
      compact
        ? null
        : {
            key: 'received',
            header: 'Received',
            width: layout.reportNumberColumnWidth,
            align: 'right',
            render: (entry) => {
              const line = entry.row.line_receiving_status ? chipFor(LINE_STATUS, entry.row.line_receiving_status) : null;
              return (
                <>
                  <CellText align="right" testID={`${testIDOf(entry)}-received`}>
                    {qty(entry.row.received_qty, entry.row.unit)}
                  </CellText>
                  {line ? <Chip label={line.label} variant={line.variant} testID={`${testIDOf(entry)}-line-status`} /> : null}
                </>
              );
            },
          },
      full
        ? {
            key: 'orderedCents',
            header: 'Ordered ₱',
            width: layout.reportNumberColumnWidth,
            align: 'right',
            render: ({ row }) => (
              <CellText variant="strong" align="right">
                {money(row.ordered_cents)}
              </CellText>
            ),
          }
        : null,
      {
        key: 'receivedCents',
        header: 'Received ₱',
        width: layout.reportNumberColumnWidth,
        align: 'right',
        render: (entry) => (
          <CellText variant="strong" align="right" testID={`${testIDOf(entry)}-received-cents`}>
            {money(entry.row.received_cents)}
          </CellText>
        ),
      },
    ];
    return columns.filter((column): column is DataTableColumn<IndexedRow> => column !== null);
  }, [mode]);
}

function purchasingFooter(totals: PurchasingReportTotals): DataTableFooter {
  return { item: 'Total', orderedCents: formatPeso(totals.ordered_cents), receivedCents: formatPeso(totals.received_cents) };
}

/**
 * The Purchasing view of Reports (§I, §L): the date range (PR created date),
 * PR status, decision, PO status and receiving filters, the summary and
 * **Export CSV**, the total cards, and the rows table (wide and phone
 * layouts) with the ordered / received money in its footer, and the
 * truncated banner. Every state: skeleton loading, error with Retry, empty,
 * pull-to-refresh.
 */
export function PurchasingReportView({ report }: { report: PurchasingReportState }) {
  const responsive = useResponsive();
  const mode = useInventoryTableMode();
  const columns = usePurchasingColumns(mode);
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const { query } = report;
  const data = query.data?.report;
  const hasRows = data !== undefined && data.rows.length > 0;
  const rows = useMemo(() => (data ? data.rows.map((row, index) => ({ row, index })) : []), [data]);

  async function refresh() {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  let status: ReactElement | null = null;
  if (query.isPending) status = <ReportStatusCard kind="loading" testID="purchasing-report-loading" />;
  else if (query.isError && !data) status = <ReportStatusCard kind="error" error={query.error} onRetry={() => void query.refetch()} testID="purchasing-report-error" />;
  else if (data && !hasRows) {
    status = (
      <ReportStatusCard
        kind="empty"
        icon="document-text-outline"
        title={report.filtersActive ? 'No requests match these filters' : 'No purchase requests in this range'}
        message={report.filtersActive ? 'Try another status or decision.' : 'Requests created in the range show here, one row per item.'}
        actionLabel={report.filtersActive ? 'Clear filters' : undefined}
        onAction={report.filtersActive ? report.clearFilters : undefined}
        testID="purchasing-report-empty"
      />
    );
  }

  const header = (
    <View style={{ gap: responsive.gutter }}>
      <ReportFilters range={report.range}>
        <FilterChipRow label="Request" options={PR_STATUS_OPTIONS} value={report.status} onChange={report.setStatus} testIDPrefix="purchasing-report-status" scroll />
        <FilterChipRow label="Decision" options={DECISION_OPTIONS} value={report.decision} onChange={report.setDecision} testIDPrefix="purchasing-report-decision" scroll />
        <FilterChipRow label="Purchase order" options={PO_STATUS_OPTIONS} value={report.poStatus} onChange={report.setPoStatus} testIDPrefix="purchasing-report-po" scroll />
        <FilterChipRow label="Receiving" options={LINE_STATUS_OPTIONS} value={report.receiving} onChange={report.setReceiving} testIDPrefix="purchasing-report-receiving" scroll />
      </ReportFilters>
      <ReportToolbar
        summary={`${dayCountLabel(report.range.dayCount)}${data ? ` · ${data.rows.length} ${data.rows.length === 1 ? 'item' : 'items'}` : ''}`}
        summaryTestID="purchasing-report-summary"
        onExport={report.exportCsv}
        exporting={report.exporting}
        disabled={!data}
        exportTestID="purchasing-report-export"
      />
      {report.exportMessage ? <Banner variant={report.exportMessage.variant} message={report.exportMessage.text} testID="purchasing-report-export-message" /> : null}
      {report.updating ? <ActivityIndicator color={colors.primaryBright} testID="purchasing-report-updating" /> : null}
      {query.isError && data ? <Banner variant="warning" message={getErrorMessage(query.error)} /> : null}
      {data ? <PurchasingTotalsCard totals={data.totals} /> : null}
      {status}
      {hasRows && query.data?.truncated ? <Banner variant="info" message={PURCHASING_TRUNCATED_MESSAGE} testID="purchasing-report-truncated" /> : null}
    </View>
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      keyExtractor={rowKey}
      rowTestID={testIDOf}
      rowAccessibilityLabel={rowLabel}
      footer={hasRows ? purchasingFooter(data.totals) : null}
      loading={query.isPending}
      rowHeight="auto"
      ListHeaderComponent={header}
      contentContainerStyle={reportContentStyle(responsive, insets.bottom)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />
      }
      testID="purchasing-report-list"
    />
  );
}
