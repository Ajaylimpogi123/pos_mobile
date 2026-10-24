/**
 * Pure mapping from `GET /dashboard` to what the page draws: insight
 * destinations, chart data, tables and summaries. Only contract fields are
 * read and nothing is estimated: a `null` section yields nothing. Mirrors the
 * tablet's `mobile/src/hooks/dashboard/dashboardModel.ts`.
 */
import type { ChartDatum } from '@/components/charts/Charts';
import type { TableData } from '@/components/charts/chartParts';
import type { SeriesSlot } from '@/components/charts/chartTheme';
import { moduleByKey, type ModuleKey } from '@/constants/modules';
import { canUseModule } from '@/hooks/useModules';
import type {
  AuthUser,
  DashboardActivity,
  DashboardCatalog,
  DashboardPeriod,
  DashboardSales,
  DashboardStaff,
  DashboardTrend,
  Insight,
  InsightAction,
  InsightSeverity,
} from '@/services/types';
import { formatBusinessDate, formatDayNumber, formatMonthShort, formatMonthYear, formatWeekdayDay, formatWeekdayShort, formatYear } from '@/utils/dates';
import { hasAnyPermission, PERMISSIONS, type PermissionSlug } from '@/utils/permissions';
import { formatPeso } from '@pos/core/money';
import { formatCount, formatPercentBps } from '@pos/core/numbers';
import { paymentMethodLabel } from '@pos/core/sale/payments';

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export const SEVERITY: Record<InsightSeverity, { label: string; tone: 'danger' | 'warning' | 'info' }> = {
  critical: { label: 'Critical', tone: 'danger' },
  warning: { label: 'Warning', tone: 'warning' },
  info: { label: 'Info', tone: 'info' },
};

/** Where an action opens: a web page or deep link built in W1–W4, and what the user needs to open it. */
type InsightTarget = { label: string; to: string; module: ModuleKey; permissions?: readonly PermissionSlug[] };

const INSIGHT_TARGETS: Record<InsightAction, InsightTarget> = {
  'menu.products': { label: 'Open products', to: '/products', module: 'products' },
  'menu.categories': { label: 'Open categories', to: '/categories', module: 'categories' },
  staff: { label: 'Open staff', to: '/staff', module: 'staff' },
  customers: { label: 'Open customers', to: '/customers', module: 'customers' },
  // Offline Sales (Phase 5): the Needs review list.
  'orders.review': { label: 'Review sales', to: '/orders/review', module: 'review' },
  // Inventory (v1 completion): the products list on Low & out.
  'inventory.alerts': { label: 'Open inventory', to: '/inventory?status=alerts', module: 'inventory' },
  // §D: Inventory → Ingredients on Low & out.
  'inventory.ingredients.alerts': { label: 'Open ingredients', to: '/inventory/ingredients?status=alerts', module: 'inventory' },
  // Q-029: the purchasing insights.
  'purchasing.requests.pending': {
    label: 'Review requests',
    to: '/purchasing/requests?view=decision',
    module: 'purchasing',
    permissions: [PERMISSIONS.purchaseApprove],
  },
  'purchasing.orders.pending': {
    label: 'Review orders',
    to: '/purchasing/orders?status=pending_approval',
    module: 'purchasing',
    permissions: [PERMISSIONS.purchaseApprove],
  },
  'purchasing.orders.to_receive': {
    label: 'Open receiving',
    to: '/purchasing/receiving',
    module: 'purchasing',
    permissions: [PERMISSIONS.purchaseReceive],
  },
  // Hardening & Pilot §C: `device_unsynced` opens admin Devices (`system.manage`).
  'settings.devices': { label: 'Open devices', to: '/settings/devices', module: 'devices' },
};

/** An insight's button, or `null`: no action, a key this build doesn't know, or a page the user can't open. */
export function insightTarget(action: string | null, user: AuthUser | null): { label: string; to: string } | null {
  if (action === null || !Object.prototype.hasOwnProperty.call(INSIGHT_TARGETS, action)) return null;
  const target = INSIGHT_TARGETS[action as InsightAction];
  if (!canUseModule(user, moduleByKey(target.module))) return null;
  if (target.permissions && !hasAnyPermission(user, target.permissions)) return null;
  return { label: target.label, to: target.to };
}

/** The insights `stock_out` / `stock_low` are built for users with `inventory.adjust` or `report.view`. */
export function canSeeStockAlerts(user: AuthUser | null): boolean {
  return hasAnyPermission(user, [PERMISSIONS.inventoryAdjust, PERMISSIONS.reportView]);
}

/** The count of an insight by key (absent means 0: an insight with a count of 0 is left out). */
export function insightCount(insights: readonly Insight[], key: string): number {
  return insights.find((insight) => insight.key === key)?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export type ChartModel = { data: ChartDatum[]; table: TableData; summary: string };

/**
 * The sales chart for the period (v1.28, `sales.trend`; slot 1), oldest
 * first. X labels: weekday for Day, day number for Month, short month for
 * Year. An older server without `trend` falls back to `last_7_days`.
 */
export function salesTrend(sales: DashboardSales): ChartModel & { hasSales: boolean } {
  const period: DashboardPeriod = sales.period ?? 'day';
  const trend: DashboardTrend = sales.trend ?? {
    unit: 'day',
    buckets: sales.last_7_days.map((day) => ({ start: day.date, orders_count: day.orders_count, net_sales_cents: day.net_sales_cents })),
  };
  const buckets = trend.buckets;
  const name = (start: string) => (trend.unit === 'month' ? formatMonthYear(start) : formatBusinessDate(start));
  const axis = (start: string) => (period === 'year' ? formatMonthShort(start) : period === 'month' ? formatDayNumber(start) : formatWeekdayShort(start));
  const title = salesTrendTitle(sales);
  return {
    hasSales: buckets.some((bucket) => bucket.orders_count > 0 || bucket.net_sales_cents !== 0),
    data: buckets.map((bucket) => ({
      key: bucket.start,
      label: axis(bucket.start),
      values: { net: bucket.net_sales_cents },
      tooltip: {
        title: name(bucket.start),
        rows: [
          { label: 'Net sales', value: formatPeso(bucket.net_sales_cents), slot: 0 },
          { label: 'Orders', value: formatCount(bucket.orders_count) },
        ],
      },
    })),
    table: {
      columns: [{ label: trend.unit === 'month' ? 'Month' : 'Day' }, { label: 'Orders', numeric: true }, { label: 'Net sales', numeric: true }],
      rows: buckets.map((bucket) => [name(bucket.start), formatCount(bucket.orders_count), formatPeso(bucket.net_sales_cents)]),
    },
    summary: `${title}. ${buckets
      .map((bucket) => `${name(bucket.start)}: ${formatPeso(bucket.net_sales_cents)}, ${bucket.orders_count} orders`)
      .join('. ')}.`,
  };
}

/** §D: `Net sales, last 7 days` · `Net sales by day, October 2026` · `Net sales by month, 2026`. */
export function salesTrendTitle(sales: DashboardSales): string {
  const period: DashboardPeriod = sales.period ?? 'day';
  if (period === 'month') return `Net sales by day, ${formatMonthYear(sales.date_from)}`;
  if (period === 'year') return `Net sales by month, ${formatYear(sales.date_from)}`;
  return 'Net sales, last 7 days';
}

/** §D empty state of the chart. */
export function salesTrendEmpty(sales: DashboardSales): string {
  const period: DashboardPeriod = sales.period ?? 'day';
  if (period === 'month') return 'No sales in this month';
  if (period === 'year') return 'No sales in this year';
  return 'No sales on this day';
}

/** The period's top products by quantity (slot 1); `periodLabel` is e.g. "Today" or "October 2026". */
export function topProducts(sales: DashboardSales, periodLabel: string): ChartModel {
  const products = sales.top_products;
  return {
    data: products.map((product) => ({
      key: String(product.product_id),
      label: product.name,
      values: { qty: product.qty },
      tooltip: {
        title: product.name,
        rows: [
          { label: 'Sold', value: formatCount(product.qty), slot: 0 },
          { label: 'Net sales', value: formatPeso(product.net_sales_cents) },
        ],
      },
    })),
    table: {
      columns: [{ label: 'Product' }, { label: 'Sold', numeric: true }, { label: 'Net sales', numeric: true }],
      rows: products.map((product) => [product.name, formatCount(product.qty), formatPeso(product.net_sales_cents)]),
    },
    summary: `Top products, ${periodLabel}. ${products.map((product) => `${product.name}: ${product.qty} sold`).join('. ')}.`,
  };
}

/** A share in basis points, rounded half up with integer maths (0 when the total is 0). */
export function shareBps(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((part * 20_000 + total) / (2 * total));
}

function slotOf(index: number): SeriesSlot {
  return Math.min(index, 2) as SeriesSlot;
}

/** The period's takings per method (cash slot 1, GCash slot 2) as one stacked bar, with a legend of amounts and shares. */
export function paymentMethods(sales: DashboardSales, periodLabel: string) {
  const methods = sales.by_payment_method;
  const total = methods.reduce((sum, entry) => sum + entry.amount_cents, 0);
  const values: Record<string, number> = {};
  for (const entry of methods) values[entry.method] = entry.amount_cents;
  const share = (cents: number) => formatPercentBps(shareBps(cents, total), 0);
  const data: ChartDatum[] = [
    {
      key: 'period',
      label: periodLabel,
      values,
      tooltip: {
        title: `Payments, ${periodLabel}`,
        rows: methods.map((entry, index) => ({ label: paymentMethodLabel(entry.method), value: formatPeso(entry.amount_cents), slot: slotOf(index) })),
      },
    },
  ];
  const table: TableData = {
    columns: [{ label: 'Method' }, { label: 'Orders', numeric: true }, { label: 'Amount', numeric: true }, { label: 'Share', numeric: true }],
    rows: methods.map((entry) => [paymentMethodLabel(entry.method), formatCount(entry.orders_count), formatPeso(entry.amount_cents), share(entry.amount_cents)]),
  };
  return {
    total,
    data,
    table,
    series: methods.map((entry, index) => ({ key: entry.method, label: paymentMethodLabel(entry.method), slot: slotOf(index) })),
    legend: methods.map((entry, index) => ({
      label: paymentMethodLabel(entry.method),
      slot: slotOf(index),
      value: `${formatPeso(entry.amount_cents)} · ${share(entry.amount_cents)}`,
    })),
    summary: `Payments, ${periodLabel}. ${methods
      .map((entry) => `${paymentMethodLabel(entry.method)}: ${formatPeso(entry.amount_cents)} from ${entry.orders_count} orders`)
      .join('. ')}.`,
  };
}

// ---------------------------------------------------------------------------
// Catalogue, staff, activity
// ---------------------------------------------------------------------------

function categoryLabel(name: string, isActive: boolean): string {
  return isActive ? name : `${name} (inactive)`;
}

/** Products by category: Available (slot 1) and Unavailable (slot 2), stacked. */
export function productsByCategory(catalog: DashboardCatalog): ChartModel {
  const rows = catalog.by_category.map((category) => ({
    category,
    label: categoryLabel(category.name, category.is_active),
    unavailable: Math.max(0, category.products_total - category.products_available),
  }));
  return {
    data: rows.map(({ category, label, unavailable }) => ({
      key: String(category.category_id),
      label,
      values: { available: category.products_available, unavailable },
      tooltip: {
        title: label,
        rows: [
          { label: 'Available', value: formatCount(category.products_available), slot: 0 },
          { label: 'Unavailable', value: formatCount(unavailable), slot: 1 },
          { label: 'Total', value: formatCount(category.products_total) },
        ],
      },
    })),
    table: {
      columns: [{ label: 'Category' }, { label: 'Available', numeric: true }, { label: 'Unavailable', numeric: true }, { label: 'Total', numeric: true }],
      rows: rows.map(({ category, label, unavailable }) => [
        label,
        formatCount(category.products_available),
        formatCount(unavailable),
        formatCount(category.products_total),
      ]),
    },
    summary: `Products by category. ${rows
      .map(({ category, label }) => `${label}: ${category.products_available} of ${category.products_total} available`)
      .join('. ')}.`,
  };
}

function marginText(bps: number | null): string {
  return bps === null ? 'No cost data' : formatPercentBps(bps);
}

/** Average margin by category (slot 1, basis points); a category with no cost data has no bar. */
export function marginByCategory(catalog: DashboardCatalog): ChartModel & { domain: [number, number] } {
  const threshold = catalog.low_margin_threshold_bps;
  const margins = catalog.by_category.map((category) => category.average_margin_bps).filter((value): value is number => value !== null);
  const low = Math.min(0, ...margins);
  const high = Math.max(threshold, ...margins);
  return {
    domain: [Math.floor(low / 1000) * 1000, Math.ceil(high / 1000) * 1000],
    data: catalog.by_category.map((category) => {
      const label = categoryLabel(category.name, category.is_active);
      return {
        key: String(category.category_id),
        label,
        values: { margin: category.average_margin_bps },
        tooltip: {
          title: label,
          rows: [
            { label: 'Average margin', value: marginText(category.average_margin_bps), slot: 0 },
            { label: 'Target', value: formatPercentBps(threshold, 0) },
          ],
        },
      };
    }),
    table: {
      columns: [{ label: 'Category' }, { label: 'Average margin', numeric: true }],
      rows: catalog.by_category.map((category) => [categoryLabel(category.name, category.is_active), marginText(category.average_margin_bps)]),
    },
    summary: `Average margin by category, target ${formatPercentBps(threshold, 0)}. ${catalog.by_category
      .map((category) => `${categoryLabel(category.name, category.is_active)}: ${marginText(category.average_margin_bps)}`)
      .join('. ')}.`,
  };
}

/** Staff by role (slot 1), every role in role-id order. */
export function staffByRole(staff: DashboardStaff): ChartModel {
  const total = staff.by_role.reduce((sum, role) => sum + role.count, 0);
  return {
    data: staff.by_role.map((role) => ({
      key: String(role.role_id),
      label: role.name,
      values: { count: role.count },
      tooltip: { title: role.name, rows: [{ label: 'Staff', value: formatCount(role.count), slot: 0 }] },
    })),
    table: {
      columns: [{ label: 'Role' }, { label: 'Staff', numeric: true }],
      rows: staff.by_role.map((role) => [role.name, formatCount(role.count)]),
      footer: ['Total', formatCount(total)],
    },
    summary: `Staff by role, ${total} in total. ${staff.by_role.map((role) => `${role.name}: ${role.count}`).join('. ')}.`,
  };
}

/** Logins (slot 1) and changes (slot 2) over the last 7 business days, one shared y-axis. */
export function activityTrend(activity: DashboardActivity): ChartModel {
  const days = activity.logins_by_day.map((day, index) => ({
    date: day.date,
    logins: day.count,
    changes: activity.changes_by_day[index]?.count ?? 0,
  }));
  const sum = (key: 'logins' | 'changes') => days.reduce((total, day) => total + day[key], 0);
  return {
    data: days.map((day, index) => ({
      key: day.date,
      label: index === days.length - 1 ? 'Today' : formatWeekdayDay(day.date),
      values: { logins: day.logins, changes: day.changes },
      tooltip: {
        title: formatBusinessDate(day.date),
        rows: [
          { label: 'Logins', value: formatCount(day.logins), slot: 0 },
          { label: 'Changes', value: formatCount(day.changes), slot: 1 },
        ],
      },
    })),
    table: {
      columns: [{ label: 'Day' }, { label: 'Logins', numeric: true }, { label: 'Changes', numeric: true }],
      rows: days.map((day) => [formatBusinessDate(day.date), formatCount(day.logins), formatCount(day.changes)]),
    },
    summary: `Activity over the last ${days.length} days. Logins: ${sum('logins')} in total. Changes: ${sum('changes')} in total.`,
  };
}
