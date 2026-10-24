/**
 * Dashboard (`GET /api/v1/dashboard`; any signed-in user, each section gated
 * server-side). back-office.md → Dashboard: the band greets the user with the
 * branch and business date; the stat cards and charts follow, and a section
 * the server returns as `null` is left out, never shown empty. Real figures
 * only; percentages are basis points and money is centavos, formatted here.
 *
 * v1.28 (Dashboard Period Filter §D): a Day · Month · Year filter in the band
 * picks the period of the `sales` section; the other sections stay current.
 * The choice is not saved, and a `422` on the filter resets it to Day / today.
 */
import {
  BoxesIcon,
  CalculatorIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  PercentIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  TrendingUpIcon,
  UserRoundIcon,
  UsersIcon,
  UtensilsCrossedIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Banner } from '@/components/common/Banner';
import { ErrorState } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { StatCard } from '@/components/common/StatCard';
import {
  InsightsCard,
  LowMarginCard,
  RecentChangesCard,
  RecentLoginsCard,
  StockAlertsCard,
  TodayFiguresCard,
} from '@/components/dashboard/DashboardCards';
import {
  ActivityCard,
  MarginByCategoryCard,
  PaymentMethodsCard,
  ProductsByCategoryCard,
  SalesTrendCard,
  StaffByRoleCard,
  TopProductsCard,
} from '@/components/dashboard/DashboardCharts';
import { canSeeStockAlerts, insightCount } from '@/components/dashboard/dashboardModel';
import { DashboardPeriodFilter } from '@/components/dashboard/DashboardPeriodFilter';
import {
  DEFAULT_DASHBOARD_FILTER,
  filterParams,
  isDefaultFilter,
  salesPeriod,
  type DashboardFilter,
} from '@/components/dashboard/dashboardPeriod';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { moduleByKey } from '@/constants/modules';
import { useBranchDay } from '@/hooks/useBranchDay';
import { useDashboard } from '@/hooks/useDashboard';
import { canUseModule } from '@/hooks/useModules';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import type { Dashboard } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { branchWallClock, formatBranchTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { formatCount, formatPercentBps, formatPercentBpsOrDash } from '@pos/core/numbers';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function LoadingDashboard() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading the dashboard…</span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-36 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

export function DashboardPage() {
  useShellHeader('Dashboard');
  const user = useSessionStore((state) => state.user);
  const { today: branchToday } = useBranchDay();
  const [filter, setFilter] = useState<DashboardFilter>(DEFAULT_DASHBOARD_FILTER);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [handledError, setHandledError] = useState<unknown>(null);
  const params = useMemo(() => filterParams(filter), [filter]);
  const query = useDashboard(params);
  const data = query.data;

  // §D: a 422 on the filter (e.g. a date after the business date) resets it to Day / today.
  if (query.error && query.error !== handledError && isApiValidationError(query.error) && !isDefaultFilter(filter)) {
    setHandledError(query.error);
    setFilter(DEFAULT_DASHBOARD_FILTER);
    setResetNotice(query.error.errors.date?.[0] ?? query.error.errors.period?.[0] ?? query.error.message);
  }

  // "Today" is the server's business date; the branch clock only until the first response.
  const today = data?.sales?.business_date ?? data?.business_date ?? branchToday;
  const showFilter = data ? data.sales !== null : hasPermission(user, PERMISSIONS.reportView);
  const changeFilter = (next: DashboardFilter) => {
    setResetNotice(null);
    setFilter(next);
  };
  const [openedAt] = useState(() => Date.now());
  // The greeting follows the branch clock when the figures were generated (or when the page opened).
  const generatedAt = data ? Date.parse(data.generated_at) : Number.NaN;
  const now = Number.isNaN(generatedAt) ? openedAt : generatedAt;
  const timezone = user?.branch.timezone ?? 'Asia/Manila';
  const firstName = user?.name.trim().split(/\s+/)[0] ?? '';
  const title = `${greeting(branchWallClock(timezone, now).hour)}${firstName ? `, ${firstName}` : ''}`;
  const updated = data ? formatBranchTime(data.generated_at, timezone) : null;

  const actions = (
    <>
      {showFilter ? <DashboardPeriodFilter filter={filter} today={today} onChange={changeFilter} /> : null}
      <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
      {query.isFetching ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <RefreshCwIcon aria-hidden="true" />}
      {query.isFetching ? 'Refreshing…' : updated ? `Updated ${updated}` : 'Refresh'}
      </Button>
    </>
  );

  return (
    <PageBand title={title} businessDate={data?.business_date ?? null} actions={actions}>
      {query.isPending ? (
        <LoadingDashboard />
      ) : !data ? (
        <div className="rounded-xl bg-card shadow-card">
          <ErrorState title="Couldn't load the dashboard" message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        </div>
      ) : (
        <>
          {query.isError ? (
            <Banner
              variant="warning"
              title="Couldn't refresh the dashboard"
              actions={
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              }
            >
              {getErrorMessage(query.error)} These figures are from {updated ?? 'earlier'}.
            </Banner>
          ) : null}
          {resetNotice ? (
            <Banner
              variant="warning"
              title="Showing today instead"
              actions={
                <Button variant="outline" size="sm" onClick={() => setResetNotice(null)}>
                  Dismiss
                </Button>
              }
            >
              {resetNotice}
            </Banner>
          ) : null}
          <DashboardContent data={data} timezone={timezone} salesLoading={query.isPlaceholderData} />
        </>
      )}
    </PageBand>
  );
}

function DashboardContent({ data, timezone, salesLoading }: { data: Dashboard; timezone: string; salesLoading: boolean }) {
  const user = useSessionStore((state) => state.user);
  const { sales, catalog, staff, customers, activity, insights } = data;
  const stockVisible = canSeeStockAlerts(user);
  const products = { out: insightCount(insights, 'stock_out'), low: insightCount(insights, 'stock_low') };
  const ingredients = { out: insightCount(insights, 'ingredients_out'), low: insightCount(insights, 'ingredients_low') };
  const changesToday = activity ? activity.changes_by_day[activity.changes_by_day.length - 1] : undefined;
  const period = sales ? salesPeriod(sales) : null;
  // While another period loads, the previous sales figures stay, dimmed (§D: only the sales part refetches).
  const salesBusy = salesLoading ? 'opacity-60 transition-opacity motion-reduce:transition-none' : undefined;

  const overview = [
    catalog ? (
      <StatCard
        key="products"
        label="Products available"
        value={formatCount(catalog.products_available)}
        icon={UtensilsCrossedIcon}
        accent="neutral"
        footnote={`of ${formatCount(catalog.products_total)} products`}
      />
    ) : null,
    catalog ? (
      <StatCard
        key="margin"
        label="Average margin"
        value={formatPercentBpsOrDash(catalog.average_margin_bps)}
        icon={PercentIcon}
        accent="neutral"
        footnote={
          catalog.average_margin_bps === null ? 'No products with cost data' : `Target ${formatPercentBps(catalog.low_margin_threshold_bps, 0)}`
        }
      />
    ) : null,
    staff ? (
      <StatCard key="staff" label="Active staff" value={formatCount(staff.active)} icon={UserRoundIcon} accent="neutral" footnote={`of ${formatCount(staff.total)} staff`} />
    ) : null,
    customers ? (
      <StatCard
        key="customers"
        label="Customers"
        value={formatCount(customers.total)}
        icon={UsersIcon}
        accent="neutral"
        footnote={`+${formatCount(customers.new_last_7_days)} this week · +${formatCount(customers.new_last_30_days)} in 30 days`}
      />
    ) : null,
    changesToday ? (
      <StatCard key="changes" label="Changes today" value={formatCount(changesToday.count)} icon={PencilLineIcon} accent="neutral" footnote="Back-office changes" />
    ) : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      {sales ? (
        <section
          aria-label={`Sales, ${period?.label ?? 'Today'}`}
          aria-busy={salesLoading}
          className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4', salesBusy)}
        >
          <StatCard
            label="Net sales"
            caption={period?.label}
            value={formatPeso(sales.net_sales_cents)}
            icon={TrendingUpIcon}
            accent="sales"
            footnote={`Gross ${formatPeso(sales.gross_sales_cents)} · discounts ${formatPeso(sales.discounts_cents)}`}
          />
          <StatCard
            label="Orders"
            caption={period?.label}
            value={formatCount(sales.orders_count)}
            icon={ReceiptTextIcon}
            accent="orders"
            footnote={`${formatCount(sales.items_sold)} ${sales.items_sold === 1 ? 'item' : 'items'} sold`}
          />
          <StatCard
            label="Average ticket"
            caption={period?.label}
            value={formatPeso(sales.average_order_cents)}
            icon={CalculatorIcon}
            accent="average"
            footnote="Net sales per order"
          />
          {stockVisible ? (
            <StatCard
              label="Low or out of stock"
              value={formatCount(products.out + products.low)}
              icon={BoxesIcon}
              accent="stock"
              footnote={`${formatCount(products.out)} out · ${formatCount(products.low)} low (products)`}
            />
          ) : (
            <StatCard
              label="Net after refunds"
              caption={period?.label}
              value={formatPeso(sales.net_after_refunds_cents)}
              icon={TrendingUpIcon}
              accent="stock"
              footnote={`Refunds ${formatPeso(sales.refunds_cents)}`}
            />
          )}
        </section>
      ) : null}

      {overview.length > 0 ? (
        <section aria-label="Overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {overview}
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {sales ? <SalesTrendCard sales={sales} className={cn('lg:col-span-2', salesBusy)} /> : null}
        {sales ? <TodayFiguresCard sales={sales} className={salesBusy} /> : null}
        {sales ? <TopProductsCard sales={sales} className={salesBusy} /> : null}
        {sales ? <PaymentMethodsCard sales={sales} className={salesBusy} /> : null}
        {stockVisible ? (
          <StockAlertsCard products={products} ingredients={ingredients} canOpenInventory={canUseModule(user, moduleByKey('inventory'))} />
        ) : null}
        <InsightsCard insights={insights} user={user} className="lg:col-span-3" />
        {catalog ? <ProductsByCategoryCard catalog={catalog} /> : null}
        {catalog ? <MarginByCategoryCard catalog={catalog} /> : null}
        {catalog ? <LowMarginCard products={catalog.low_margin_products} thresholdBps={catalog.low_margin_threshold_bps} /> : null}
        {staff ? <StaffByRoleCard staff={staff} /> : null}
        {staff ? <RecentLoginsCard logins={staff.recent_logins} timezone={timezone} /> : null}
        {activity ? <ActivityCard activity={activity} className={staff ? undefined : 'lg:col-span-2'} /> : null}
        {activity ? <RecentChangesCard changes={activity.recent_changes} timezone={timezone} /> : null}
      </div>
    </div>
  );
}
