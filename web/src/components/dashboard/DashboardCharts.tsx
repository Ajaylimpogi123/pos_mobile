/**
 * The dashboard's chart cards (back-office.md → Dashboard; the legacy
 * revenue, top-products and payment-methods charts): each one a Recharts
 * chart with a "View as table" fallback and an accessible summary.
 */
import { useMemo } from 'react';

import { ChartCard } from '@/components/charts/ChartCard';
import { BarsChart, TrendChart } from '@/components/charts/Charts';
import {
  activityTrend,
  marginByCategory,
  paymentMethods,
  productsByCategory,
  salesTrend,
  salesTrendEmpty,
  salesTrendTitle,
  staffByRole,
  topProducts,
} from '@/components/dashboard/dashboardModel';
import { salesPeriod } from '@/components/dashboard/dashboardPeriod';
import type { DashboardActivity, DashboardCatalog, DashboardSales, DashboardStaff } from '@/services/types';
import { formatBusinessDate } from '@/utils/dates';
import { formatCompactPesos } from '@pos/core/money';
import { formatCount, formatPercentBps } from '@pos/core/numbers';

function EmptyChart({ children }: { children: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

/** "No sales yet today." for the running day; the §D period wording otherwise. */
function noSalesText(sales: DashboardSales, today: string): string {
  const period = salesPeriod(sales);
  return period.period === 'day' && period.current ? today : `${salesTrendEmpty(sales)}.`;
}

export function SalesTrendCard({ sales, className }: { sales: DashboardSales; className?: string }) {
  const model = useMemo(() => salesTrend(sales), [sales]);
  const period = salesPeriod(sales);
  const description =
    period.period === 'day'
      ? `The 7 business days ending ${period.current ? 'today' : formatBusinessDate(period.anchor)}, in pesos.`
      : period.period === 'month'
        ? 'Per business day, in pesos.'
        : 'Per month, in pesos.';
  return (
    <ChartCard title={salesTrendTitle(sales)} description={description} summary={model.summary} table={model.table} className={className}>
      {model.hasSales ? (
        <TrendChart data={model.data} series={[{ key: 'net', label: 'Net sales', slot: 0 }]} formatTick={formatCompactPesos} />
      ) : (
        <EmptyChart>{`${salesTrendEmpty(sales)}.`}</EmptyChart>
      )}
    </ChartCard>
  );
}

export function TopProductsCard({ sales, className }: { sales: DashboardSales; className?: string }) {
  const label = salesPeriod(sales).label;
  const model = useMemo(() => topProducts(sales, label), [sales, label]);
  return (
    <ChartCard title="Top products" description={`${label}, by quantity sold.`} summary={model.summary} table={model.table} className={className}>
      {model.data.length > 0 ? (
        <BarsChart data={model.data} series={[{ key: 'qty', label: 'Sold', slot: 0 }]} formatTick={formatCount} labelWidth={140} />
      ) : (
        <EmptyChart>{noSalesText(sales, 'No sales yet today.')}</EmptyChart>
      )}
    </ChartCard>
  );
}

export function PaymentMethodsCard({ sales, className }: { sales: DashboardSales; className?: string }) {
  const label = salesPeriod(sales).label;
  const model = useMemo(() => paymentMethods(sales, label), [sales, label]);
  return (
    <ChartCard title="Payment methods" description={`${label}, takings net of change.`} summary={model.summary} table={model.table} className={className}>
      {model.total > 0 ? (
        <BarsChart data={model.data} series={model.series} formatTick={formatCompactPesos} stacked labelWidth={120} legend={model.legend} />
      ) : (
        <EmptyChart>{noSalesText(sales, 'No payments yet today.')}</EmptyChart>
      )}
    </ChartCard>
  );
}

export function ProductsByCategoryCard({ catalog }: { catalog: DashboardCatalog }) {
  const model = useMemo(() => productsByCategory(catalog), [catalog]);
  return (
    <ChartCard title="Products by category" description="Available and unavailable products." summary={model.summary} table={model.table}>
      {model.data.length > 0 ? (
        <BarsChart
          data={model.data}
          series={[
            { key: 'available', label: 'Available', slot: 0 },
            { key: 'unavailable', label: 'Unavailable', slot: 1 },
          ]}
          formatTick={formatCount}
          stacked
        />
      ) : (
        <EmptyChart>No categories yet.</EmptyChart>
      )}
    </ChartCard>
  );
}

export function MarginByCategoryCard({ catalog }: { catalog: DashboardCatalog }) {
  const model = useMemo(() => marginByCategory(catalog), [catalog]);
  const threshold = catalog.low_margin_threshold_bps;
  return (
    <ChartCard
      title="Average margin by category"
      description={`Price against cost; the dashed line is the ${formatPercentBps(threshold, 0)} target.`}
      summary={model.summary}
      table={model.table}
    >
      {model.data.length > 0 ? (
        <BarsChart
          data={model.data}
          series={[{ key: 'margin', label: 'Average margin', slot: 0 }]}
          formatTick={(value) => formatPercentBps(value, 0)}
          domain={model.domain}
          reference={{ value: threshold, label: 'Target' }}
        />
      ) : (
        <EmptyChart>No categories yet.</EmptyChart>
      )}
    </ChartCard>
  );
}

export function StaffByRoleCard({ staff }: { staff: DashboardStaff }) {
  const model = useMemo(() => staffByRole(staff), [staff]);
  return (
    <ChartCard title="Staff by role" description="Every role in this branch." summary={model.summary} table={model.table}>
      <BarsChart data={model.data} series={[{ key: 'count', label: 'Staff', slot: 0 }]} formatTick={formatCount} />
    </ChartCard>
  );
}

export function ActivityCard({ activity, className }: { activity: DashboardActivity; className?: string }) {
  const model = useMemo(() => activityTrend(activity), [activity]);
  return (
    <ChartCard title="Activity, last 7 days" description="Logins and back-office changes per business day." summary={model.summary} table={model.table} className={className}>
      <TrendChart
        data={model.data}
        series={[
          { key: 'logins', label: 'Logins', slot: 0 },
          { key: 'changes', label: 'Changes', slot: 1 },
        ]}
        formatTick={formatCount}
      />
    </ChartCard>
  );
}
