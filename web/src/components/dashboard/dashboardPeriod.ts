/**
 * The dashboard's period filter (api-contract "Dashboard Period Filter" §B,
 * §D): Day · Month · Year plus an anchor business date. Pure helpers over
 * `YYYY-MM-DD` labels, read as calendar dates (never shifted by the browser's
 * timezone). "Today" is always the server's current business date `T`.
 */
import type { DashboardParams, DashboardPeriod, DashboardSales } from '@/services/types';
import { formatBusinessDate, formatMonthYear, formatYear } from '@/utils/dates';
import { addBusinessDays } from '@pos/core/businessDay';

/** `anchor: null` means the current business date (whatever `T` is when the request is made). */
export type DashboardFilter = { period: DashboardPeriod; anchor: string | null };

/** The dashboard opens on Day / today (§D: the choice is not saved). */
export const DEFAULT_DASHBOARD_FILTER: DashboardFilter = { period: 'day', anchor: null };

export const PERIOD_OPTIONS: readonly { value: DashboardPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const UNIT: Record<DashboardPeriod, string> = { day: 'day', month: 'month', year: 'year' };

export function isDefaultFilter(filter: DashboardFilter): boolean {
  return filter.period === 'day' && filter.anchor === null;
}

/** The query sent to `GET /dashboard`: only the params that are set (Day / today sends none). */
export function filterParams(filter: DashboardFilter): DashboardParams {
  const params: DashboardParams = {};
  if (filter.period !== 'day') params.period = filter.period;
  if (filter.anchor !== null) params.date = filter.anchor;
  return params;
}

type Ymd = { year: number; month: number; day: number };

function parse(ymd: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function format({ year, month, day }: Ymd): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** One day, month or year before (`step` −1) or after (+1); the day is clamped to the target month (31 Oct − 1 month = 30 Sep). */
export function shiftAnchor(ymd: string, period: DashboardPeriod, step: -1 | 1): string {
  if (period === 'day') return addBusinessDays(ymd, step);
  const parsed = parse(ymd);
  if (!parsed) return ymd;
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
  return format({ year, month, day: Math.min(parsed.day, daysInMonth(year, month)) });
}

/** Whether two business dates fall in the same day, month or year. */
export function samePeriod(a: string, b: string, period: DashboardPeriod): boolean {
  if (period === 'day') return a === b;
  if (period === 'month') return a.slice(0, 7) === b.slice(0, 7);
  return a.slice(0, 4) === b.slice(0, 4);
}

/** Whether the filter shows the period that contains `today` (then `›` is disabled). */
export function isCurrentPeriod(filter: DashboardFilter, today: string): boolean {
  return filter.anchor === null || today === '' || samePeriod(filter.anchor, today, filter.period) || filter.anchor > today;
}

export function previousPeriod(filter: DashboardFilter, today: string): DashboardFilter {
  const from = filter.anchor ?? today;
  if (from === '') return filter;
  return { period: filter.period, anchor: shiftAnchor(from, filter.period, -1) };
}

/** The next period; reaching `today` (or past it) returns to "current" (`anchor: null`). */
export function nextPeriod(filter: DashboardFilter, today: string): DashboardFilter {
  if (filter.anchor === null) return filter;
  const next = shiftAnchor(filter.anchor, filter.period, 1);
  return { period: filter.period, anchor: today !== '' && next >= today ? null : next };
}

/** §D labels: `Tue, 14 Oct 2026` · `October 2026` · `2026`; the current period reads `Today` · `This month` · `This year`. */
export function periodLabel(period: DashboardPeriod, anchor: string, current: boolean): string {
  if (period === 'day') return current ? 'Today' : formatBusinessDate(anchor);
  if (period === 'month') return current ? 'This month' : formatMonthYear(anchor);
  return current ? 'This year' : formatYear(anchor);
}

/** The stepper's label for the filter. */
export function filterLabel(filter: DashboardFilter, today: string): string {
  return periodLabel(filter.period, filter.anchor ?? today, isCurrentPeriod(filter, today));
}

/** "Previous day" / "Next month"… for the icon-only stepper buttons. */
export function stepLabel(period: DashboardPeriod, step: -1 | 1): string {
  return `${step < 0 ? 'Previous' : 'Next'} ${UNIT[period]}`;
}

/** The period the returned `sales` figures cover (from the response, so labels match the figures even while the next period loads). */
export type SalesPeriod = { period: DashboardPeriod; anchor: string; current: boolean; label: string };

export function salesPeriod(sales: DashboardSales): SalesPeriod {
  // An older server without v1.28 fields is read as Day / today.
  const period: DashboardPeriod = sales.period ?? 'day';
  const anchor = (period === 'day' ? sales.date_to : sales.date_from) ?? sales.business_date;
  const current = samePeriod(anchor, sales.business_date, period);
  return { period, anchor, current, label: periodLabel(period, anchor, current) };
}
