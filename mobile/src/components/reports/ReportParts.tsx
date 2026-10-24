import { memo, useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { LineChart } from '@/components/charts/LineChart';
import type { TableData } from '@/components/charts/ChartParts';
import { SectionCard } from '@/components/dashboard/SectionCard';
import type { InventoryTableMode } from '@/components/reports/InventoryReportParts';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CellText, type DataTableColumn, type DataTableFooter } from '@/components/ui/DataTable';
import { chart, colors, layout, radius, shadows, sizes, spacing, statAccent, typography, type StatAccentKey } from '@/constants/theme';
import type { Responsive } from '@/hooks/useResponsive';
import type { SalesReportGroupBy, SalesReportRow, SalesReportTotals } from '@/services/types';
import { formatBusinessDate } from '@/utils/dates';
import { formatCompactPesos, formatPeso } from '@pos/core/money';
import { formatCount, NO_VALUE } from '@pos/core/numbers';

const [SLOT_1] = chart.series;

// ---------------------------------------------------------------------------
// Toolbar (shared by every report view)
// ---------------------------------------------------------------------------

type ReportToolbarProps = {
  summary: string;
  summaryTestID: string;
  onExport: () => void;
  exporting: boolean;
  /** No data to export yet. */
  disabled: boolean;
  exportTestID: string;
};

/** The report's summary line ("7 days · 12 products") and its **Export CSV** outline button (download + share sheet), in a white card over the band. */
export const ReportToolbar = memo(function ReportToolbar({ summary, summaryTestID, onExport, exporting, disabled, exportTestID }: ReportToolbarProps) {
  return (
    <View style={styles.toolbar}>
      <Text style={styles.summary} testID={summaryTestID}>
        {summary}
      </Text>
      <Button
        title="Export CSV"
        leftIcon="download-outline"
        variant="secondary"
        onPress={onExport}
        loading={exporting}
        disabled={disabled || exporting}
        testID={exportTestID}
      />
    </View>
  );
});

/** A report list's content: a centred column (max 1200) with the page padding and the bottom safe area. */
export function reportContentStyle(responsive: Responsive, bottomInset: number): StyleProp<ViewStyle> {
  return [
    styles.content,
    {
      maxWidth: responsive.contentMaxWidth,
      paddingHorizontal: responsive.screenPaddingX,
      paddingTop: responsive.screenPaddingY,
      paddingBottom: bottomInset + responsive.screenPaddingY + layout.tabBarHeight,
    },
  ];
}

/** "1 day" / "7 days". */
export function dayCountLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

// ---------------------------------------------------------------------------
// Total cards (shared by every report view)
// ---------------------------------------------------------------------------

export type ReportTotal = {
  key: string;
  label: string;
  value: string;
  testID: string;
  /** The report's headline figure (net sales): drawn in the `sales` accent. */
  emphasis?: boolean;
  /** MASTER §1.4: the figure's accent (net sales green, orders blue, average purple, stock orange); others stay neutral. */
  accent?: StatAccentKey;
};

function accentOf(total: ReportTotal): StatAccentKey | null {
  if (total.accent) return total.accent;
  return total.emphasis ? 'sales' : null;
}

/** A total card keeps at least this width before the row wraps (≈ 5 across on a tablet). */
const TOTAL_MIN_WIDTH = layout.reportNumberColumnWidth + spacing.giant + spacing.lg;

/**
 * The totals as a row of small white cards: a label over a 22 / 700 tabular
 * value; the §1.4 figures (net sales, orders) take their accent colour, the
 * rest stay neutral. Cards wrap to as many rows as they need.
 */
export const ReportTotalCards = memo(function ReportTotalCards({ totals, testID }: { totals: readonly ReportTotal[]; testID: string }) {
  return (
    <View style={styles.totals} accessibilityLabel="Totals" testID={testID}>
      {totals.map((total) => {
        const accent = accentOf(total);
        return (
          <View
            key={total.key}
            style={styles.total}
            accessible
            accessibilityLabel={`${total.label}: ${total.value}`}
          >
            <Text style={styles.totalLabel} numberOfLines={2}>
              {total.label}
            </Text>
            <Text
              style={[styles.totalValue, accent ? { color: statAccent[accent].color } : null]}
              numberOfLines={1}
              adjustsFontSizeToFit
              testID={total.testID}
            >
              {total.value}
            </Text>
          </View>
        );
      })}
    </View>
  );
});

/**
 * The sales totals: net sales (emphasised), orders, items, gross, discounts,
 * VAT, SC/PWD (its discount, and the VAT exempted when not 0), and (Phase 7)
 * voids, refunds and net after refunds.
 */
export const ReportTotalsCard = memo(function ReportTotalsCard({ totals }: { totals: SalesReportTotals }) {
  const items = useMemo(() => {
    const list: ReportTotal[] = [
      { key: 'net', label: 'Net sales', value: formatPeso(totals.net_sales_cents), testID: 'report-total-net', emphasis: true },
      { key: 'orders', label: 'Orders', value: formatCount(totals.orders_count), testID: 'report-total-orders', accent: 'orders' },
      { key: 'items', label: 'Items sold', value: formatCount(totals.items_sold), testID: 'report-total-items' },
      { key: 'gross', label: 'Gross sales', value: formatPeso(totals.gross_sales_cents), testID: 'report-total-gross' },
      { key: 'discounts', label: 'Discounts', value: formatPeso(totals.discounts_cents), testID: 'report-total-discounts' },
      { key: 'vat', label: 'VAT (included)', value: formatPeso(totals.vat_amount_cents), testID: 'report-total-vat' },
      // Senior Citizen / PWD Discount (part of Discounts).
      {
        key: 'sc-pwd',
        label: `SC/PWD (${formatCount(totals.sc_pwd_orders_count ?? 0)})`,
        value: formatPeso(totals.sc_pwd_discount_cents ?? 0),
        testID: 'report-total-sc-pwd',
      },
    ];
    if ((totals.sc_pwd_vat_relief_cents ?? 0) !== 0) {
      list.push({ key: 'sc-pwd-vat', label: 'VAT exempted (SC/PWD)', value: formatPeso(totals.sc_pwd_vat_relief_cents), testID: 'report-total-sc-pwd-vat' });
    }
    // Dine-in Tables & Tabs: the service charge (part of Net sales), when there is one.
    if ((totals.service_charge_cents ?? 0) !== 0) {
      list.push({ key: 'service-charge', label: 'Service charge', value: formatPeso(totals.service_charge_cents), testID: 'report-total-service-charge' });
    }
    // Voids & Refunds (Phase 7).
    list.push(
      { key: 'voids', label: `Voids (${formatCount(totals.voids_count ?? 0)})`, value: formatPeso(totals.voids_cents ?? 0), testID: 'report-total-voids' },
      {
        key: 'refunds',
        label: `Refunds (${formatCount(totals.refunds_count ?? 0)})`,
        value: formatPeso(totals.refunds_cents ?? 0),
        testID: 'report-total-refunds',
      },
      {
        key: 'net-after-refunds',
        label: 'Net after refunds',
        value: formatPeso(totals.net_after_refunds_cents ?? totals.net_sales_cents),
        testID: 'report-total-net-after-refunds',
      },
    );
    return list;
  }, [totals]);
  return <ReportTotalCards totals={items} testID="report-totals" />;
});

// ---------------------------------------------------------------------------
// Day chart
// ---------------------------------------------------------------------------

function xLabel(row: SalesReportRow): string {
  return String(Number(row.label.slice(8, 10)));
}

/**
 * Net sales per business day (`group_by=day`), on the shared line chart: one
 * series (no legend), tap tooltips in pesos, and "View as table". Real rows
 * only, including the 0-filled days. Ranges longer than 31 days use the
 * table. The chart model is memoised on the rows.
 */
export const ReportDayChart = memo(function ReportDayChart({
  rows,
  showTable,
  onToggleTable,
}: {
  rows: readonly SalesReportRow[];
  showTable: boolean;
  onToggleTable: () => void;
}) {
  const model = useMemo(() => {
    const table: TableData = {
      columns: ['Day', 'Orders', 'Net sales'],
      rows: rows.map((row) => [formatBusinessDate(row.label), formatCount(row.orders_count), formatPeso(row.net_sales_cents)]),
    };
    const total = rows.reduce((sum, row) => sum + row.net_sales_cents, 0);
    return {
      table,
      series: [{ key: 'net', label: 'Net sales', color: SLOT_1, values: rows.map((row) => row.net_sales_cents) }],
      xLabels: rows.map(xLabel),
      columnTitles: rows.map((row) => formatBusinessDate(row.label)),
      accessibilityLabel: `Net sales per day, ${rows.length} days, total ${formatPeso(total)}`,
    };
  }, [rows]);

  if (rows.length === 0) return null;
  if (rows.length > layout.reportChartMaxDays) {
    return (
      <Card testID="report-chart-too-long">
        <Text style={styles.note}>The chart shows up to {layout.reportChartMaxDays} days. Every day is in the table below.</Text>
      </Card>
    );
  }
  return (
    <SectionCard
      title="Net sales per day"
      subtitle="Completed sales per business day (₱)"
      tableToggle={{ showTable, onToggle: onToggleTable }}
      testID="report-chart-card"
    >
      <LineChart
        series={model.series}
        xLabels={model.xLabels}
        columnTitles={model.columnTitles}
        accessibilityLabel={model.accessibilityLabel}
        showTable={showTable}
        table={model.table}
        formatValue={formatPeso}
        formatTick={formatCompactPesos}
        area
        testID="report-chart"
      />
    </SectionCard>
  );
});

// ---------------------------------------------------------------------------
// Sales rows table
// ---------------------------------------------------------------------------

function money(cents: number | null): string {
  return cents === null ? NO_VALUE : formatPeso(cents);
}

function rowLabel(row: SalesReportRow, groupBy: SalesReportGroupBy): string {
  return groupBy === 'day' ? formatBusinessDate(row.label) : row.label;
}

function countsLine(row: SalesReportRow): string {
  return `${formatCount(row.orders_count)} ${row.orders_count === 1 ? 'order' : 'orders'}${row.qty === null ? '' : ` · ${formatCount(row.qty)} sold`}${
    row.refunded_qty ? ` · ${formatCount(row.refunded_qty)} refunded` : ''
  }${(row.refunds_cents ?? 0) > 0 ? ` · refunds ${formatPeso(row.refunds_cents)}` : ''}`;
}

/** What a screen reader says for a sales row. */
export function salesRowAccessibilityLabel(row: SalesReportRow, groupBy: SalesReportGroupBy): string {
  return `${rowLabel(row, groupBy)}: ${countsLine(row)}, net ${formatPeso(row.net_sales_cents)}, net after refunds ${formatPeso(
    row.net_after_refunds_cents ?? row.net_sales_cents,
  )}`;
}

const FIRST_HEADER: Record<SalesReportGroupBy, string> = { day: 'Day', product: 'Product', category: 'Category', payment: 'Payment', cashier: 'Cashier' };

/**
 * The sales rows table's columns: every column on tablet landscape; tablet
 * portrait / phone landscape drop gross and discounts; phone portrait shows
 * the label (counts under it), net and net after refunds. Numbers are
 * right-aligned; payment rows show "—" for qty, gross and discounts.
 */
export function useSalesColumns(groupBy: SalesReportGroupBy, mode: InventoryTableMode): DataTableColumn<SalesReportRow>[] {
  return useMemo(() => {
    const compact = mode === 'compact';
    const columns: (DataTableColumn<SalesReportRow> | null)[] = [
      {
        key: 'label',
        header: FIRST_HEADER[groupBy],
        flex: 1,
        render: (row) => (
          <>
            <CellText variant="strong" numberOfLines={compact ? 2 : 1}>
              {rowLabel(row, groupBy)}
            </CellText>
            {compact ? (
              <CellText variant="muted" numberOfLines={3}>
                {countsLine(row)}
              </CellText>
            ) : null}
          </>
        ),
      },
      compact
        ? null
        : { key: 'orders', header: 'Orders', width: layout.reportCountColumnWidth, align: 'right', render: (row) => formatCount(row.orders_count) },
      compact
        ? null
        : { key: 'qty', header: 'Qty', width: layout.reportCountColumnWidth, align: 'right', render: (row) => (row.qty === null ? NO_VALUE : formatCount(row.qty)) },
      mode === 'full'
        ? { key: 'gross', header: 'Gross', width: layout.reportNumberColumnWidth, align: 'right', render: (row) => money(row.gross_sales_cents) }
        : null,
      mode === 'full'
        ? { key: 'discounts', header: 'Discounts', width: layout.reportNumberColumnWidth, align: 'right', render: (row) => money(row.discounts_cents) }
        : null,
      {
        key: 'net',
        header: 'Net',
        width: layout.reportNumberColumnWidth,
        align: 'right',
        render: (row) => (
          <CellText variant="strong" align="right" testID={`report-row-${row.key}-net`}>
            {formatPeso(row.net_sales_cents)}
          </CellText>
        ),
      },
      compact
        ? null
        : {
            key: 'refunds',
            header: 'Refunds',
            width: layout.reportNumberColumnWidth,
            align: 'right',
            render: (row) => (
              <>
                <CellText align="right" style={(row.refunds_cents ?? 0) > 0 ? styles.refunded : styles.zero} testID={`report-row-${row.key}-refunds`}>
                  {formatPeso(row.refunds_cents ?? 0)}
                </CellText>
                {row.refunded_qty ? (
                  <CellText variant="muted" align="right">
                    {formatCount(row.refunded_qty)} refunded
                  </CellText>
                ) : null}
              </>
            ),
          },
      {
        key: 'after',
        header: 'Net after refunds',
        width: layout.reportNumberColumnWidth,
        align: 'right',
        render: (row) => (
          <CellText variant="strong" align="right" testID={`report-row-${row.key}-net-after-refunds`}>
            {formatPeso(row.net_after_refunds_cents ?? row.net_sales_cents)}
          </CellText>
        ),
      },
    ];
    return columns.filter((column): column is DataTableColumn<SalesReportRow> => column !== null);
  }, [groupBy, mode]);
}

/** The sales table's totals row. */
export function salesFooter(totals: SalesReportTotals): DataTableFooter {
  return {
    label: 'Total',
    orders: formatCount(totals.orders_count),
    qty: formatCount(totals.items_sold),
    gross: formatPeso(totals.gross_sales_cents),
    discounts: formatPeso(totals.discounts_cents),
    net: formatPeso(totals.net_sales_cents),
    refunds: formatPeso(totals.refunds_cents ?? 0),
    after: formatPeso(totals.net_after_refunds_cents ?? totals.net_sales_cents),
  };
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    alignSelf: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  summary: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
    minWidth: layout.sectionTitleMinWidth,
  },
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md + spacing.xxs,
  },
  total: {
    flexGrow: 1,
    flexBasis: TOTAL_MIN_WIDTH,
    gap: spacing.xs + spacing.xxs,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg + spacing.xxs,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  totalLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  totalValue: {
    ...typography.metricValue,
    color: colors.text,
  },
  note: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  refunded: {
    color: colors.pendingText,
  },
  zero: {
    color: colors.textSecondary,
  },
});
