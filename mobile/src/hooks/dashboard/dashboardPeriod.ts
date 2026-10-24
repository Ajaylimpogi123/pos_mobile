/**
 * Dashboard Period Filter (v1.28, §D): the Day · Month · Year filter's state,
 * the request it maps to, the date stepper and every period-dependent label.
 * Pure: "today" is always the server's current business date, never the
 * device clock. Dates are `YYYY-MM-DD` business-day labels (no timezone).
 */
import { addBusinessDays } from '@pos/core/businessDay';
import type { BusinessDate, DashboardParams, DashboardPeriod, DashboardSales } from '@/services/types';
import { formatBusinessDate } from '@/utils/dates';

/** The filter as the user set it. `date: null` means the current period (the server's business date). */
export type DashboardFilter = { period: DashboardPeriod; date: BusinessDate | null };

/** Not saved: the dashboard always opens on Day / today. */
export const DEFAULT_DASHBOARD_FILTER: DashboardFilter = { period: 'day', date: null };

export const PERIOD_OPTIONS: readonly { value: DashboardPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

type Ymd = { year: number; month: number; day: number };

function parse(ymd: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month, day: Number(match[3]) };
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

function format({ year, month, day }: Ymd): BusinessDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The query for a filter: each param only when it differs from the server's
 * default (`period=day`, `date` = the current business date), so Day / today
 * is the plain `GET /dashboard`.
 */
export function dashboardParams(filter: DashboardFilter): DashboardParams {
  const params: DashboardParams = {};
  if (filter.period !== 'day') params.period = filter.period;
  if (filter.date !== null) params.date = filter.date;
  return params;
}

/** Whether `anchor` lies in the current day / month / year (`today` = the server's business date). */
export function isCurrentPeriod(period: DashboardPeriod, anchor: BusinessDate, today: BusinessDate): boolean {
  const length = period === 'day' ? 10 : period === 'month' ? 7 : 4;
  return anchor.slice(0, length) >= today.slice(0, length);
}

/**
 * The anchor one day / month / year before (`step` −1) or after (+1). Months
 * and years keep the day of the month (clamped to the month's length), so
 * switching back to Day lands on the same date. A result on or after `today`
 * is the current date again: `null`.
 */
export function shiftAnchor(
  period: DashboardPeriod,
  anchor: BusinessDate,
  step: -1 | 1,
  today: BusinessDate,
): BusinessDate | null {
  let next: BusinessDate;
  if (period === 'day') {
    next = addBusinessDays(anchor, step);
  } else {
    const parsed = parse(anchor);
    if (!parsed) return null;
    let { year, month } = parsed;
    if (period === 'month') {
      month += step;
      if (month < 1) {
        month = 12;
        year -= 1;
      } else if (month > 12) {
        month = 1;
        year += 1;
      }
    } else {
      year += step;
    }
    next = format({ year, month, day: Math.min(parsed.day, daysInMonth(year, month)) });
  }
  return next >= today ? null : next;
}

/** "October 2026" for any date in the month. */
export function formatMonthYear(ymd: BusinessDate): string {
  const parsed = parse(ymd);
  return parsed ? `${MONTHS_LONG[parsed.month - 1]} ${parsed.year}` : ymd;
}

/** "Oct" for any date in the month. */
export function formatMonthShort(ymd: BusinessDate): string {
  const parsed = parse(ymd);
  return parsed ? MONTHS_SHORT[parsed.month - 1] : ymd;
}

/** "2026". */
export function formatYear(ymd: BusinessDate): string {
  return ymd.slice(0, 4);
}

/** The label of the current period. */
export const CURRENT_LABEL: Record<DashboardPeriod, string> = { day: 'Today', month: 'This month', year: 'This year' };

/**
 * The stepper label and the stat cards' caption: `Today` · `This month` ·
 * `This year` for the current period, else `Tue, 14 Oct 2026` · `October 2026` · `2026`.
 */
export function periodLabel(period: DashboardPeriod, anchor: BusinessDate, today: BusinessDate): string {
  if (isCurrentPeriod(period, anchor, today)) return CURRENT_LABEL[period];
  if (period === 'day') return formatBusinessDate(anchor);
  if (period === 'month') return formatMonthYear(anchor);
  return formatYear(anchor);
}

/** The label of the period a `sales` section covers (from the server's echo, so it always matches the figures). */
export function salesPeriodLabel(sales: DashboardSales): string {
  return periodLabel(sales.period, sales.date_from, sales.business_date);
}

/** The trend chart's title: `Net sales, last 7 days` · `Net sales by day, October 2026` · `Net sales by month, 2026`. */
export function trendChartTitle(sales: DashboardSales): string {
  if (sales.period === 'month') return `Net sales by day, ${formatMonthYear(sales.date_from)}`;
  if (sales.period === 'year') return `Net sales by month, ${formatYear(sales.date_from)}`;
  return 'Net sales, last 7 days';
}

/** The sales card's empty state (Q-050: the running day keeps "No sales yet today."). */
export function noSalesMessage(period: DashboardPeriod, current = false): string {
  if (period === 'day' && current) return 'No sales yet today.';
  if (period === 'month') return 'No sales in this month';
  if (period === 'year') return 'No sales in this year';
  return 'No sales on this day';
}

/** The trend chart's description: Q-050 wording for Day; per day / per month otherwise. */
export function trendChartDescription(sales: DashboardSales): string {
  if (sales.period === 'day') {
    const end = isCurrentPeriod('day', sales.date_to, sales.business_date) ? 'Today' : formatBusinessDate(sales.date_to);
    return `The 7 business days ending ${end}, in pesos.`;
  }
  return sales.trend.unit === 'month' ? 'Completed sales per month' : 'Completed sales per business day';
}

/** "Tue, 14 Oct 2026" for a day; "1 – 14 Oct 2026" for a month; "1 Jan – 14 Oct 2026" for a year. */
export function salesRangeLabel(sales: DashboardSales): string {
  if (sales.period === 'day') return formatBusinessDate(sales.date_from);
  const from = parse(sales.date_from);
  const to = parse(sales.date_to);
  if (!from || !to) return `${sales.date_from} – ${sales.date_to}`;
  const end = `${to.day} ${MONTHS_SHORT[to.month - 1]} ${to.year}`;
  const start =
    from.year !== to.year
      ? `${from.day} ${MONTHS_SHORT[from.month - 1]} ${from.year}`
      : from.month !== to.month
        ? `${from.day} ${MONTHS_SHORT[from.month - 1]}`
        : `${from.day}`;
  return `${start} – ${end}`;
}
