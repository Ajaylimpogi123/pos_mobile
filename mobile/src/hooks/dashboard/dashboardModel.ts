/**
 * Pure mapping from the dashboard response to what the screen draws: KPI
 * tiles, chart rows, table views and accessibility summaries. Only fields the
 * contract defines are read, and nothing is estimated: a section that is
 * `null` yields nothing, and an unknown value stays "—" / "No cost data".
 */
import type { Href } from 'expo-router';

import type { BarRow, BarSeries } from '@/components/charts/HorizontalBarChart';
import type { DonutDatum } from '@/components/charts/DonutChart';
import type { LineSeries } from '@/components/charts/LineChart';
import type { TableData } from '@/components/charts/ChartParts';
import { marginDomain, niceTicks } from '@/components/charts/chartMath';
import type { IconName } from '@/components/ui/Icon';
import {
  ingredientAlertsRoute,
  inventoryAlertsRoute,
  ordersNeedingReviewRoute,
  pendingPurchaseOrdersRoute,
  purchaseRequestsNeedingDecisionRoute,
  ROUTES,
} from '@/constants/routes';
import { chart, type StatAccentKey } from '@/constants/theme';
import { paymentMethodLabel } from '@pos/core/sale/payments';
import type {
  AuthUser,
  Dashboard,
  DashboardActivity,
  DashboardCatalog,
  DashboardSales,
  DashboardStaff,
  InsightAction,
  InsightSeverity,
} from '@/services/types';
import {
  formatMonthShort,
  formatMonthYear,
  salesPeriodLabel,
  trendChartTitle,
} from '@/hooks/dashboard/dashboardPeriod';
import { formatBusinessDate, formatWeekdayShort } from '@/utils/dates';
import { formatPeso } from '@pos/core/money';
import { formatCount, formatPercentBps, formatPercentBpsOrDash } from '@pos/core/numbers';
import { hasAnyPermission, PERMISSIONS, type PermissionSlug } from '@/utils/permissions';

const [SLOT_1, SLOT_2] = chart.series;

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

export type KpiTile = {
  key: 'net-sales' | 'orders' | 'average' | 'stock' | 'products' | 'margin' | 'staff' | 'customers' | 'changes';
  label: string;
  value: string;
  detail: string;
  icon: IconName;
  /** MASTER §1.4: only Net sales, Orders, Average ticket and Low or out of stock carry an accent; the rest are neutral. */
  accent: StatAccentKey | null;
};

/** The insights `stock_out` / `stock_low` are built for users with `inventory.adjust` or `report.view`. */
export function canSeeStockAlerts(user: AuthUser | null): boolean {
  return hasAnyPermission(user, [PERMISSIONS.inventoryAdjust, PERMISSIONS.reportView]);
}

/** The count of an insight by key (absent means 0: an insight with a count of 0 is left out). */
export function insightCount(data: Pick<Dashboard, 'insights'>, key: string): number {
  return data.insights.find((insight) => insight.key === key)?.count ?? 0;
}

/** Low and out counts for products and ingredients, from the stock insights. */
export function stockAlerts(data: Pick<Dashboard, 'insights'>) {
  return {
    products: { out: insightCount(data, 'stock_out'), low: insightCount(data, 'stock_low') },
    ingredients: { out: insightCount(data, 'ingredients_out'), low: insightCount(data, 'ingredients_low') },
  };
}

/**
 * The stat cards (back-office.md → Dashboard), each only when its section is
 * present: Net sales (green), Orders (blue), Average ticket (purple) and Low or
 * out of stock (orange) first, then the neutral overview figures.
 */
export function kpiTiles(data: Dashboard, user: AuthUser | null = null): KpiTile[] {
  const tiles: KpiTile[] = [];
  const { catalog, staff, customers, activity, sales } = data;

  if (sales) {
    // v1.28 §D: the period label ("Today", "October 2026", …) is each sales card's caption.
    const period = salesPeriodLabel(sales);
    tiles.push({
      key: 'net-sales',
      label: 'Net sales',
      value: formatPeso(sales.net_sales_cents),
      detail: `${period} · gross ${formatPeso(sales.gross_sales_cents)}`,
      icon: 'trending-up-outline',
      accent: 'sales',
    });
    tiles.push({
      key: 'orders',
      label: 'Orders',
      value: formatCount(sales.orders_count),
      detail: `${period} · ${formatCount(sales.items_sold)} ${sales.items_sold === 1 ? 'item' : 'items'} sold`,
      icon: 'receipt-outline',
      accent: 'orders',
    });
    tiles.push({
      key: 'average',
      label: 'Average ticket',
      value: formatPeso(sales.average_order_cents),
      detail: `${period} · net sales per order`,
      icon: 'calculator-outline',
      accent: 'average',
    });
  }
  if (canSeeStockAlerts(user)) {
    const { products } = stockAlerts(data);
    tiles.push({
      key: 'stock',
      label: 'Low or out of stock',
      value: formatCount(products.out + products.low),
      detail: `${formatCount(products.out)} out · ${formatCount(products.low)} low (products)`,
      icon: 'cube-outline',
      accent: 'stock',
    });
  }

  if (catalog) {
    tiles.push({
      key: 'products',
      label: 'Products available',
      value: formatCount(catalog.products_available),
      detail: `of ${formatCount(catalog.products_total)} products`,
      icon: 'fast-food-outline',
      accent: null,
    });
    tiles.push({
      key: 'margin',
      label: 'Average margin',
      value: formatPercentBpsOrDash(catalog.average_margin_bps),
      detail:
        catalog.average_margin_bps === null
          ? 'No products with cost data'
          : `Target ${formatPercentBps(catalog.low_margin_threshold_bps, 0)}`,
      icon: 'trending-up-outline',
      accent: null,
    });
  }
  if (staff) {
    tiles.push({
      key: 'staff',
      label: 'Active staff',
      value: formatCount(staff.active),
      detail: `of ${formatCount(staff.total)} staff`,
      icon: 'people-outline',
      accent: null,
    });
  }
  if (customers) {
    tiles.push({
      key: 'customers',
      label: 'Customers',
      value: formatCount(customers.total),
      detail: `+${formatCount(customers.new_last_7_days)} this week`,
      icon: 'person-circle-outline',
      accent: null,
    });
  }
  if (activity) {
    const today = activity.changes_by_day[activity.changes_by_day.length - 1];
    tiles.push({
      key: 'changes',
      label: 'Changes today',
      value: today ? formatCount(today.count) : '—',
      detail: today ? formatBusinessDate(today.date) : 'No data',
      icon: 'create-outline',
      accent: null,
    });
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export const SEVERITY_META: Record<InsightSeverity, { label: string; icon: IconName; variant: 'danger' | 'warning' | 'info' }> = {
  critical: { label: 'Critical', icon: 'alert-circle', variant: 'danger' },
  warning: { label: 'Warning', icon: 'warning', variant: 'warning' },
  info: { label: 'Info', icon: 'information-circle', variant: 'info' },
};

/** `permission`: needed to open the destination (a list: any one of them; `null`: everyone). */
type InsightTarget = { label: string; route: Href; permission: PermissionSlug | readonly PermissionSlug[] | null };

const INSIGHT_TARGETS: Record<InsightAction, InsightTarget> = {
  'menu.products': { label: 'Open products', route: ROUTES.menuProducts, permission: PERMISSIONS.productManage },
  'menu.categories': { label: 'Open categories', route: ROUTES.menuCategories, permission: PERMISSIONS.productManage },
  staff: { label: 'Open staff', route: ROUTES.staff, permission: PERMISSIONS.userManage },
  customers: { label: 'Open customers', route: ROUTES.customers, permission: null },
  // Offline Sales (Phase 5): opens Orders with the Needs review filter.
  'orders.review': { label: 'Review sales', route: ordersNeedingReviewRoute(), permission: PERMISSIONS.orderReview },
  // Inventory (v1 completion): `stock_out` / `stock_low` open the list with the Low & out filter.
  'inventory.alerts': {
    label: 'Open inventory',
    route: inventoryAlertsRoute(),
    permission: [PERMISSIONS.inventoryAdjust, PERMISSIONS.reportView],
  },
  // Ingredients, Recipes & Purchasing §D: `ingredients_out` / `ingredients_low` open Inventory → Ingredients (Low & out).
  'inventory.ingredients.alerts': {
    label: 'Open ingredients',
    route: ingredientAlertsRoute(),
    permission: [PERMISSIONS.inventoryAdjust, PERMISSIONS.reportView],
  },
  // §I insights. Q-029: the action keys the contract confirmed.
  'purchasing.requests.pending': {
    label: 'Review requests',
    route: purchaseRequestsNeedingDecisionRoute(),
    permission: PERMISSIONS.purchaseApprove,
  },
  'purchasing.orders.pending': {
    label: 'Review orders',
    route: pendingPurchaseOrdersRoute(),
    permission: PERMISSIONS.purchaseApprove,
  },
  'purchasing.orders.to_receive': {
    label: 'Open receiving',
    route: ROUTES.receiving,
    permission: PERMISSIONS.purchaseReceive,
  },
  // Hardening & Pilot §C: `device_unsynced` opens admin Devices.
  'settings.devices': { label: 'Open devices', route: ROUTES.devices, permission: PERMISSIONS.systemManage },
};

/**
 * Where an insight's action goes, or `null` for no button: no action, an
 * action key this build doesn't know, or a destination the user can't open.
 */
export function insightTarget(action: string | null, user: AuthUser | null): InsightTarget | null {
  if (action === null || !Object.prototype.hasOwnProperty.call(INSIGHT_TARGETS, action)) return null;
  const target = INSIGHT_TARGETS[action as InsightAction];
  if (target.permission !== null) {
    const slugs: readonly PermissionSlug[] = typeof target.permission === 'string' ? [target.permission] : target.permission;
    if (!hasAnyPermission(user, slugs)) return null;
  }
  return target;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export type BarChartModel = {
  series: BarSeries[];
  rows: BarRow[];
  domain: { min: number; max: number };
  reference?: { value: number; label: string };
  table: TableData;
  accessibilityLabel: string;
};

function categoryLabel(name: string, isActive: boolean): string {
  return isActive ? name : `${name} (inactive)`;
}

/** Products by category: stacked Available (slot 1) + Unavailable (slot 2 = total − available). */
export function productsByCategoryChart(catalog: DashboardCatalog): BarChartModel {
  const series: BarSeries[] = [
    { key: 'available', label: 'Available', color: SLOT_1 },
    { key: 'unavailable', label: 'Unavailable', color: SLOT_2 },
  ];
  const rows: BarRow[] = catalog.by_category.map((category) => {
    const available = category.products_available;
    const unavailable = Math.max(0, category.products_total - available);
    return {
      key: String(category.category_id),
      label: categoryLabel(category.name, category.is_active),
      values: [available, unavailable],
      endLabel: `${formatCount(available)}/${formatCount(category.products_total)}`,
      tooltip: {
        title: categoryLabel(category.name, category.is_active),
        rows: [
          { label: 'Available', value: formatCount(available), color: SLOT_1 },
          { label: 'Unavailable', value: formatCount(unavailable), color: SLOT_2 },
          { label: 'Total', value: formatCount(category.products_total) },
        ],
      },
    };
  });
  const maxTotal = Math.max(0, ...catalog.by_category.map((category) => category.products_total));

  return {
    series,
    rows,
    domain: { min: 0, max: niceTicks(maxTotal).max },
    table: {
      columns: ['Category', 'Available', 'Unavailable', 'Total'],
      rows: rows.map((row, index) => {
        const category = catalog.by_category[index];
        return [row.label, formatCount(category.products_available), formatCount(Math.max(0, category.products_total - category.products_available)), formatCount(category.products_total)];
      }),
    },
    accessibilityLabel:
      rows.length === 0
        ? 'Products by category: no categories yet.'
        : `Products by category. ${catalog.by_category
            .map((category) => `${categoryLabel(category.name, category.is_active)}: ${category.products_available} of ${category.products_total} available`)
            .join('. ')}.`,
  };
}

/** Average margin by category: one series (slot 1), a dashed reference line at the threshold. */
export function marginByCategoryChart(catalog: DashboardCatalog): BarChartModel {
  const threshold = catalog.low_margin_threshold_bps;
  const rows: BarRow[] = catalog.by_category.map((category) => {
    const margin = category.average_margin_bps;
    const label = categoryLabel(category.name, category.is_active);
    return {
      key: String(category.category_id),
      label,
      values: margin === null ? null : [margin],
      endLabel: margin === null ? '' : formatPercentBps(margin),
      tooltip: {
        title: label,
        rows: [
          { label: 'Average margin', value: margin === null ? 'No cost data' : formatPercentBps(margin), color: SLOT_1 },
          { label: 'Target', value: formatPercentBps(threshold, 0) },
        ],
      },
    };
  });

  return {
    series: [{ key: 'margin', label: 'Average margin', color: SLOT_1 }],
    rows,
    domain: marginDomain(
      catalog.by_category.map((category) => category.average_margin_bps),
      threshold,
    ),
    reference: { value: threshold, label: `${formatPercentBps(threshold, 0)} target` },
    table: {
      columns: ['Category', 'Average margin'],
      rows: catalog.by_category.map((category) => [
        categoryLabel(category.name, category.is_active),
        category.average_margin_bps === null ? 'No cost data' : formatPercentBps(category.average_margin_bps),
      ]),
    },
    accessibilityLabel:
      rows.length === 0
        ? 'Average margin by category: no categories yet.'
        : `Average margin by category, target ${formatPercentBps(threshold, 0)}. ${catalog.by_category
            .map(
              (category) =>
                `${categoryLabel(category.name, category.is_active)}: ${
                  category.average_margin_bps === null ? 'no cost data' : formatPercentBps(category.average_margin_bps)
                }`,
            )
            .join('. ')}.`,
  };
}

export type DonutModel = {
  data: DonutDatum[];
  total: number;
  table: TableData;
  accessibilityLabel: string;
};

/**
 * Staff by role: colour follows the role in role-id order (owner slot 1,
 * manager slot 2, cashier slot 3), never its rank. A 4th role or more is
 * folded into "Other" in muted gray (never a generated hue).
 */
export function staffByRoleChart(staff: DashboardStaff): DonutModel {
  const named = staff.by_role.slice(0, chart.series.length);
  const extra = staff.by_role.slice(chart.series.length);
  const data: DonutDatum[] = named.map((role, index) => ({
    key: role.slug,
    label: role.name,
    value: role.count,
    color: chart.series[index],
  }));
  if (extra.length > 0) {
    data.push({ key: 'other', label: 'Other', value: extra.reduce((sum, role) => sum + role.count, 0), color: chart.other });
  }
  const total = staff.by_role.reduce((sum, role) => sum + role.count, 0);

  return {
    data,
    total,
    table: {
      columns: ['Role', 'Staff'],
      rows: [...staff.by_role.map((role) => [role.name, formatCount(role.count)]), ['Total', formatCount(total)]],
    },
    accessibilityLabel: `Staff by role, ${total} in total. ${staff.by_role.map((role) => `${role.name}: ${role.count}`).join('. ')}.`,
  };
}

export type LineModel = {
  series: LineSeries[];
  xLabels: string[];
  columnTitles: string[];
  table: TableData;
  accessibilityLabel: string;
};

/** Activity, last 7 days: Logins (slot 1) and Changes (slot 2: every non-auth audit entry) on one shared y-axis. */
export function activityChart(activity: DashboardActivity): LineModel {
  const days = activity.logins_by_day.map((day) => day.date);
  const logins = activity.logins_by_day.map((day) => day.count);
  const changes = days.map((_date, index) => activity.changes_by_day[index]?.count ?? 0);
  const last = (values: number[]) => values[values.length - 1] ?? 0;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  return {
    series: [
      { key: 'logins', label: 'Logins', color: SLOT_1, values: logins, legendValue: `${formatCount(last(logins))} today` },
      { key: 'changes', label: 'Changes', color: SLOT_2, values: changes, legendValue: `${formatCount(last(changes))} today` },
    ],
    xLabels: days.map(formatWeekdayShort),
    columnTitles: days.map(formatBusinessDate),
    table: {
      columns: ['Day', 'Logins', 'Changes'],
      rows: days.map((date, index) => [formatBusinessDate(date), formatCount(logins[index]), formatCount(changes[index])]),
    },
    accessibilityLabel:
      `Activity over the last ${days.length} days. ` +
      `Logins: ${sum(logins)} in total, ${last(logins)} today. ` +
      `Changes: ${sum(changes)} in total, ${last(changes)} today.`,
  };
}

// ---------------------------------------------------------------------------
// Sales (Phase 3): only real figures from `sales`, never estimated
// ---------------------------------------------------------------------------

/** Whether any bucket of the period's trend had a sale (otherwise the trend chart is left out). */
export function hasSalesInTrend(sales: DashboardSales): boolean {
  return sales.trend.buckets.some((bucket) => bucket.orders_count > 0);
}

/**
 * Net sales of the period's trend (v1.28 §D), one green series with its 18 %
 * area, oldest first. X labels: the weekday (Day: the 7 days ending on the
 * chosen day), the day number (Month) or the short month name (Year).
 */
export function salesTrendChart(sales: DashboardSales): LineModel {
  const { unit, buckets } = sales.trend;
  const byMonth = unit === 'month';
  const xLabel = (start: string) =>
    byMonth ? formatMonthShort(start) : sales.period === 'month' ? String(Number(start.slice(8, 10))) : formatWeekdayShort(start);
  const title = (start: string) => (byMonth ? formatMonthYear(start) : formatBusinessDate(start));
  const chartTitle = trendChartTitle(sales);
  return {
    series: [{ key: 'net', label: 'Net sales', color: SLOT_1, values: buckets.map((bucket) => bucket.net_sales_cents) }],
    xLabels: buckets.map((bucket) => xLabel(bucket.start)),
    columnTitles: buckets.map((bucket) => title(bucket.start)),
    table: {
      columns: [byMonth ? 'Month' : 'Day', 'Orders', 'Net sales'],
      rows: buckets.map((bucket) => [title(bucket.start), formatCount(bucket.orders_count), formatPeso(bucket.net_sales_cents)]),
    },
    accessibilityLabel: `${chartTitle}. ${buckets
      .map((bucket) => `${title(bucket.start)}: ${formatPeso(bucket.net_sales_cents)}, ${bucket.orders_count} orders`)
      .join('. ')}.`,
  };
}

/** "₱3,000.00 · 74%" of the whole (no percentage when there is nothing). */
function shareLabel(cents: number, total: number): string {
  if (total <= 0) return formatPeso(cents);
  return `${formatPeso(cents)} · ${Math.round((cents / total) * 100)}%`;
}

/**
 * The period's takings by payment method, net of change (back-office.md): **one
 * stacked bar** (cash, then GCash, in series order) plus a legend with each
 * method's amount and share.
 */
export function paymentMethodsChart(sales: DashboardSales): BarChartModel {
  const methods = sales.by_payment_method;
  const total = methods.reduce((sum, entry) => sum + Math.max(0, entry.amount_cents), 0);
  const period = salesPeriodLabel(sales);
  const series: BarSeries[] = methods.map((entry, index) => ({
    key: entry.method,
    label: paymentMethodLabel(entry.method),
    color: chart.series[index] ?? chart.other,
    legendValue: shareLabel(entry.amount_cents, total),
  }));

  return {
    series,
    rows: [
      {
        key: 'period',
        label: period,
        values: methods.map((entry) => entry.amount_cents),
        endLabel: formatPeso(total),
        tooltip: {
          title: `Payments · ${period}`,
          rows: methods.map((entry, index) => ({
            label: paymentMethodLabel(entry.method),
            value: `${shareLabel(entry.amount_cents, total)} · ${formatCount(entry.orders_count)} orders`,
            color: series[index].color,
          })),
        },
      },
    ],
    domain: { min: 0, max: niceTicks(total).max },
    table: {
      columns: ['Method', 'Orders', 'Amount'],
      rows: methods.map((entry) => [paymentMethodLabel(entry.method), formatCount(entry.orders_count), formatPeso(entry.amount_cents)]),
    },
    accessibilityLabel: `Payments · ${period}: ${formatPeso(total)} in total. ${methods
      .map((entry) => `${paymentMethodLabel(entry.method)}: ${shareLabel(entry.amount_cents, total)}, from ${entry.orders_count} orders`)
      .join('. ')}.`,
  };
}
