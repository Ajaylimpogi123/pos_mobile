/**
 * Sales report (`GET /reports/sales`; Shifts & Reporting → Sales reports,
 * Q-013, Q-019, Phase 7 refunds, SC/PWD): the `group_by` tabs, the totals
 * as the server sent them, a net-sales chart for `day`, then the rows with a
 * totals footer. Payment rows have no quantity, gross or discounts ("—").
 */
import { useMemo } from 'react';

import { ChartCard } from '@/components/charts/ChartCard';
import { TrendChart, type ChartDatum } from '@/components/charts/Charts';
import type { TableData } from '@/components/charts/chartParts';
import { ReportFrame, ReportTotals, type ReportTotal } from '@/components/reports/ReportParts';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GROUP_BY_OPTIONS, type SalesReportState } from '@/hooks/reports/useReports';
import type { SalesReportGroupBy, SalesReportRow, SalesReportTotals } from '@/services/types';
import { formatBusinessDate, formatDayMonth } from '@/utils/dates';
import { formatCompactPesos, formatPeso } from '@pos/core/money';
import { formatCount, NO_VALUE } from '@pos/core/numbers';

/** The day chart shows up to this many days; longer ranges use the table. */
const CHART_MAX_DAYS = 92;

const FIRST_HEADER: Record<SalesReportGroupBy, string> = { day: 'Day', product: 'Product', category: 'Category', payment: 'Payment', cashier: 'Cashier' };

const column = dataTableColumns<SalesReportRow>();

function money(cents: number | null): string {
  return cents === null ? NO_VALUE : formatPeso(cents);
}

function rowLabel(row: SalesReportRow, groupBy: SalesReportGroupBy): string {
  return groupBy === 'day' ? formatBusinessDate(row.label) : row.label;
}

function salesTotals(totals: SalesReportTotals): ReportTotal[] {
  const list: ReportTotal[] = [
    { key: 'net', label: 'Net sales', value: formatPeso(totals.net_sales_cents), emphasis: true },
    { key: 'orders', label: 'Orders', value: formatCount(totals.orders_count) },
    { key: 'items', label: 'Items sold', value: formatCount(totals.items_sold) },
    { key: 'gross', label: 'Gross sales', value: formatPeso(totals.gross_sales_cents) },
    { key: 'discounts', label: 'Discounts', value: formatPeso(totals.discounts_cents) },
    { key: 'vat', label: 'VAT (included)', value: formatPeso(totals.vat_amount_cents) },
    { key: 'sc-pwd', label: `SC/PWD (${formatCount(totals.sc_pwd_orders_count)})`, value: formatPeso(totals.sc_pwd_discount_cents) },
    // Dine-in §G: its own row (net sales already include it).
    { key: 'service-charge', label: 'Service charge', value: formatPeso(totals.service_charge_cents ?? 0) },
  ];
  if (totals.sc_pwd_vat_relief_cents !== 0) {
    list.push({ key: 'sc-pwd-vat', label: 'VAT exempted (SC/PWD)', value: formatPeso(totals.sc_pwd_vat_relief_cents) });
  }
  list.push(
    { key: 'voids', label: `Voids (${formatCount(totals.voids_count)})`, value: formatPeso(totals.voids_cents) },
    {
      key: 'refunds',
      label: `Refunds (${formatCount(totals.refunds_count)})`,
      value: formatPeso(totals.refunds_cents),
      tone: totals.refunds_cents > 0 ? 'danger' : undefined,
    },
    { key: 'after', label: 'Net after refunds', value: formatPeso(totals.net_after_refunds_cents) },
  );
  return list;
}

function DayChart({ rows }: { rows: readonly SalesReportRow[] }) {
  const model = useMemo(() => {
    const data: ChartDatum[] = rows.map((row) => ({
      key: row.key,
      label: formatDayMonth(row.label),
      values: { net: row.net_sales_cents },
      tooltip: {
        title: formatBusinessDate(row.label),
        rows: [
          { label: 'Net sales', value: formatPeso(row.net_sales_cents), slot: 0 },
          { label: 'Orders', value: formatCount(row.orders_count) },
          { label: 'Refunds', value: formatPeso(row.refunds_cents) },
        ],
      },
    }));
    const table: TableData = {
      columns: [{ label: 'Day' }, { label: 'Orders', numeric: true }, { label: 'Net sales', numeric: true }, { label: 'Refunds', numeric: true }],
      rows: rows.map((row) => [formatBusinessDate(row.label), formatCount(row.orders_count), formatPeso(row.net_sales_cents), formatPeso(row.refunds_cents)]),
    };
    const total = rows.reduce((sum, row) => sum + row.net_sales_cents, 0);
    return { data, table, summary: `Net sales per day, ${rows.length} days, total ${formatPeso(total)}.` };
  }, [rows]);

  if (rows.length === 0) return null;
  if (rows.length > CHART_MAX_DAYS) {
    return <p className="text-sm text-muted-foreground">The chart shows up to {CHART_MAX_DAYS} days. Every day is in the table below.</p>;
  }
  return (
    <ChartCard title="Net sales per day" description="Sales that are not voided, per business day (₱)." summary={model.summary} table={model.table}>
      <TrendChart data={model.data} series={[{ key: 'net', label: 'Net sales', slot: 0 }]} formatTick={formatCompactPesos} height={260} />
    </ChartCard>
  );
}

export function SalesReportView({ report }: { report: SalesReportState }) {
  const result = report.query.data;
  const data = result?.report;
  const groupBy = data?.group_by ?? report.groupBy;
  // Phase 7: a range with only refunds (of earlier sales) or voids still has figures to show.
  const hasFigures = data !== undefined && (data.totals.orders_count > 0 || data.totals.refunds_count > 0 || data.totals.voids_count > 0);

  const columns = useMemo<DataTableColumn<SalesReportRow>[]>(
    () => [
      column.display({
        id: 'label',
        header: FIRST_HEADER[groupBy],
        cell: ({ row }) => <span className="font-medium">{rowLabel(row.original, groupBy)}</span>,
      }),
      column.display({ id: 'orders', header: 'Orders', meta: { align: 'right' }, cell: ({ row }) => formatCount(row.original.orders_count) }),
      column.display({
        id: 'qty',
        header: 'Qty',
        meta: { align: 'right' },
        cell: ({ row }) => (row.original.qty === null ? NO_VALUE : formatCount(row.original.qty)),
      }),
      column.display({ id: 'gross', header: 'Gross', meta: { align: 'right' }, cell: ({ row }) => money(row.original.gross_sales_cents) }),
      column.display({ id: 'discounts', header: 'Discounts', meta: { align: 'right' }, cell: ({ row }) => money(row.original.discounts_cents) }),
      column.display({
        id: 'net',
        header: 'Net',
        meta: { align: 'right' },
        cell: ({ row }) => <span className="font-semibold">{formatPeso(row.original.net_sales_cents)}</span>,
      }),
      column.display({
        id: 'refunds',
        header: 'Refunds',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <div className="flex flex-col items-end">
            <span className={row.original.refunds_cents > 0 ? 'text-danger' : 'text-muted-foreground'}>{formatPeso(row.original.refunds_cents)}</span>
            {row.original.refunded_qty ? <span className="text-[13px] text-muted-foreground">{formatCount(row.original.refunded_qty)} refunded</span> : null}
          </div>
        ),
      }),
      column.display({
        id: 'after',
        header: 'Net after refunds',
        meta: { align: 'right' },
        cell: ({ row }) => <span className="font-semibold text-green">{formatPeso(row.original.net_after_refunds_cents)}</span>,
      }),
    ],
    [groupBy],
  );

  const footer = data
    ? {
        label: 'Total',
        orders: formatCount(data.totals.orders_count),
        qty: formatCount(data.totals.items_sold),
        gross: formatPeso(data.totals.gross_sales_cents),
        discounts: formatPeso(data.totals.discounts_cents),
        net: formatPeso(data.totals.net_sales_cents),
        refunds: formatPeso(data.totals.refunds_cents),
        after: formatPeso(data.totals.net_after_refunds_cents),
      }
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={report.groupBy} onValueChange={(value) => report.setGroupBy(value as SalesReportGroupBy)}>
        <TabsList aria-label="Group by">
          {GROUP_BY_OPTIONS.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ReportFrame
        query={report.query}
        hasData={data !== undefined}
        empty={data && !hasFigures ? { title: 'No sales in this range', message: 'Sales, voids and refunds show here. Try a longer range.' } : null}
        truncated={result?.truncated === true}
        updating={report.updating}
        exportError={report.exportError}
        onDismissExportError={report.dismissExportError}
        noun="sales report"
      >
        {data ? (
          <>
            <ReportTotals totals={salesTotals(data.totals)} />
            {data.group_by === 'day' ? <DayChart rows={data.rows} /> : null}
            <Card className="overflow-hidden">
              <DataTable
                label={`Sales by ${FIRST_HEADER[data.group_by].toLowerCase()}`}
                columns={columns}
                data={data.rows}
                getRowId={(row) => row.key}
                footer={footer}
              />
            </Card>
          </>
        ) : null}
      </ReportFrame>
    </div>
  );
}
