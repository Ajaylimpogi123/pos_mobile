/**
 * Dashboard Period Filter (contract v1.28 §A–§D): the request params, the
 * query key under the `dashboard` prefix, the Day · Month · Year filter and
 * its stepper (anchored on the server's business date), the period labels,
 * the trend chart and the 422 reset.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import DashboardRoute from '@/app/(app)/index';
import {
  dashboardParams,
  DEFAULT_DASHBOARD_FILTER,
  isCurrentPeriod,
  noSalesMessage,
  periodLabel,
  shiftAnchor,
  trendChartDescription,
  trendChartTitle,
} from '@/hooks/dashboard/dashboardPeriod';
import { salesTrendChart } from '@/hooks/dashboard/dashboardModel';
import { queryKeys } from '@/hooks/dashboard/queryKeys';
import { getDashboard } from '@/services/dashboard';
import type { DashboardPeriod, DashboardSales } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { managerUser, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { managerDashboard } from '@/test-utils/dashboard';
import { makeSales } from '@/test-utils/sale';

const FUTURE = '2099-09-25T01:30:00Z';
const TODAY = '2026-10-14';

/** A `sales` section echoing the request, as §B/§C describe it. */
function salesFor(period: DashboardPeriod, date: string): DashboardSales {
  const from = period === 'day' ? date : period === 'month' ? `${date.slice(0, 8)}01` : `${date.slice(0, 4)}-01-01`;
  const to = period === 'day' ? date : date.slice(0, 7) === TODAY.slice(0, 7) || period === 'year' ? TODAY : `${date.slice(0, 8)}28`;
  const buckets =
    period === 'year'
      ? [
          { start: `${date.slice(0, 4)}-01-01`, orders_count: 3, net_sales_cents: 30000 },
          { start: `${date.slice(0, 4)}-02-01`, orders_count: 4, net_sales_cents: 40000 },
        ]
      : [
          { start: from, orders_count: 2, net_sales_cents: 20000 },
          { start: to, orders_count: 5, net_sales_cents: 50000 },
        ];
  return makeSales({
    period,
    date_from: from,
    date_to: to,
    business_date: TODAY,
    trend: { unit: period === 'year' ? 'month' : 'day', buckets },
  });
}

function serve(options: { rejectDates?: boolean } = {}) {
  return routeFetch([
    {
      method: 'GET',
      path: '/api/v1/dashboard',
      reply: (call: FetchCall) => {
        const date = call.query.get('date');
        if (options.rejectDates && date) {
          return mockResponse(422, { message: "The date can't be in the future.", errors: { date: ["The date can't be in the future."] } });
        }
        const period = (call.query.get('period') ?? 'day') as DashboardPeriod;
        return mockResponse(200, {
          data: managerDashboard({ business_date: TODAY, sales: salesFor(period, date ?? TODAY) }),
        });
      },
    },
  ]);
}

function lastQuery(calls: FetchCall[]): string {
  const call = calls[calls.length - 1];
  return call.query.toString();
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
});

describe('period helpers', () => {
  it('maps the filter to params, sending each only when set', () => {
    expect(dashboardParams(DEFAULT_DASHBOARD_FILTER)).toEqual({});
    expect(dashboardParams({ period: 'month', date: null })).toEqual({ period: 'month' });
    expect(dashboardParams({ period: 'day', date: '2026-10-05' })).toEqual({ date: '2026-10-05' });
    expect(dashboardParams({ period: 'year', date: '2025-03-01' })).toEqual({ period: 'year', date: '2025-03-01' });
  });

  it('formats labels: the current period reads Today / This month / This year', () => {
    expect(periodLabel('day', TODAY, TODAY)).toBe('Today');
    expect(periodLabel('day', TODAY, '2026-10-15')).toBe('Wed, 14 Oct 2026');
    expect(periodLabel('month', '2026-10-05', TODAY)).toBe('This month');
    expect(periodLabel('month', '2026-09-30', TODAY)).toBe('September 2026');
    expect(periodLabel('year', '2026-01-01', TODAY)).toBe('This year');
    expect(periodLabel('year', '2025-12-31', TODAY)).toBe('2025');
    expect(noSalesMessage('day', true)).toBe('No sales yet today.');
    expect(noSalesMessage('day')).toBe('No sales on this day');
    expect(noSalesMessage('month')).toBe('No sales in this month');
    expect(noSalesMessage('year')).toBe('No sales in this year');
  });

  it('steps one unit, keeps the day of the month (clamped), and never passes the business date', () => {
    expect(shiftAnchor('day', TODAY, -1, TODAY)).toBe('2026-10-13');
    expect(shiftAnchor('day', '2026-10-13', 1, TODAY)).toBeNull();
    expect(shiftAnchor('month', TODAY, -1, TODAY)).toBe('2026-09-14');
    expect(shiftAnchor('month', '2026-03-31', -1, TODAY)).toBe('2026-02-28');
    expect(shiftAnchor('month', '2026-01-10', -1, TODAY)).toBe('2025-12-10');
    expect(shiftAnchor('month', '2026-09-05', 1, TODAY)).toBe('2026-10-05');
    expect(shiftAnchor('month', '2026-09-20', 1, TODAY)).toBeNull();
    expect(shiftAnchor('year', '2024-02-29', 1, TODAY)).toBe('2025-02-28');
    expect(isCurrentPeriod('month', '2026-10-01', TODAY)).toBe(true);
    expect(isCurrentPeriod('month', '2026-09-30', TODAY)).toBe(false);
  });

  it('titles and draws the chart from `trend`', () => {
    const month = salesFor('month', '2026-09-10');
    expect(trendChartTitle(month)).toBe('Net sales by day, September 2026');
    expect(salesTrendChart(month).xLabels).toEqual(['1', '28']);
    const year = salesFor('year', '2025-06-01');
    expect(trendChartTitle(year)).toBe('Net sales by month, 2025');
    expect(salesTrendChart(year).xLabels).toEqual(['Jan', 'Feb']);
    expect(salesTrendChart(year).columnTitles).toEqual(['January 2025', 'February 2025']);
    const day = salesFor('day', TODAY);
    expect(trendChartTitle(day)).toBe('Net sales, last 7 days');
    expect(salesTrendChart(day).xLabels).toEqual(['Wed', 'Wed']);
    expect(trendChartDescription(day)).toBe('The 7 business days ending Today, in pesos.');
    expect(trendChartDescription(salesFor('day', '2026-10-13'))).toBe('The 7 business days ending Tue, 13 Oct 2026, in pesos.');
  });
});

describe('getDashboard', () => {
  it('sends period and date only when set', async () => {
    const { calls } = serve();
    await getDashboard();
    expect(calls[0].path).toBe('/api/v1/dashboard');
    expect(lastQuery(calls)).toBe('');
    await getDashboard({ period: 'month', date: '2026-10-05' });
    expect(lastQuery(calls)).toBe('period=month&date=2026-10-05');
  });

  it('keeps the dashboard key as the prefix of every period key', () => {
    expect(queryKeys.dashboardFor({ period: 'year' }).slice(0, 1)).toEqual([...queryKeys.dashboard]);
  });
});

describe('Period filter on the dashboard', () => {
  it('opens on Day / Today with › disabled; ‹ goes back a day and › comes back', async () => {
    const { calls } = serve();
    await renderWithQuery(<DashboardRoute />);

    expect(await screen.findByTestId('dashboard-period-filter')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId('dashboard-period-previous')).not.toBeDisabled());
    expect(screen.getByTestId('dashboard-period-label')).toHaveTextContent('Today');
    expect(screen.getByTestId('dashboard-period-next')).toBeDisabled();
    expect(screen.getByTestId('dashboard-period-day').props.accessibilityState).toMatchObject({ selected: true });
    expect(lastQuery(calls)).toBe('');
    expect(screen.getByTestId('kpi-net-sales-detail')).toHaveTextContent(/^Today/);

    await fireEvent.press(screen.getByTestId('dashboard-period-previous'));
    expect(screen.getByTestId('dashboard-period-label')).toHaveTextContent('Tue, 13 Oct 2026');
    await waitFor(() => expect(lastQuery(calls)).toBe('date=2026-10-13'));
    await waitFor(() => expect(screen.getByTestId('dashboard-sales')).toHaveTextContent(/Tue, 13 Oct 2026/));
    expect(screen.getByTestId('dashboard-period-next')).not.toBeDisabled();

    await fireEvent.press(screen.getByTestId('dashboard-period-next'));
    expect(screen.getByTestId('dashboard-period-label')).toHaveTextContent('Today');
    expect(screen.getByTestId('dashboard-period-next')).toBeDisabled();
  });

  it('switching the segment keeps the anchor date', async () => {
    const { calls } = serve();
    await renderWithQuery(<DashboardRoute />);
    await waitFor(() => expect(screen.getByTestId('dashboard-period-previous')).not.toBeDisabled());

    await fireEvent.press(screen.getByTestId('dashboard-period-previous'));
    await fireEvent.press(screen.getByTestId('dashboard-period-month'));
    expect(screen.getByTestId('dashboard-period-label')).toHaveTextContent('This month');
    await waitFor(() => expect(lastQuery(calls)).toBe('period=month&date=2026-10-13'));

    await fireEvent.press(screen.getByTestId('dashboard-period-previous'));
    expect(screen.getByTestId('dashboard-period-label')).toHaveTextContent('September 2026');
    await waitFor(() => expect(screen.getByTestId('chart-card-sales-trend')).toHaveTextContent(/Net sales by day, September 2026/));
    expect(screen.getByTestId('kpi-net-sales-detail')).toHaveTextContent(/^September 2026/);

    await fireEvent.press(screen.getByTestId('dashboard-period-day'));
    expect(screen.getByTestId('dashboard-period-label')).toHaveTextContent('Sun, 13 Sep 2026');

    await fireEvent.press(screen.getByTestId('dashboard-period-year'));
    expect(screen.getByTestId('dashboard-period-label')).toHaveTextContent('This year');
    await waitFor(() => expect(lastQuery(calls)).toBe('period=year&date=2026-09-13'));
    await waitFor(() => expect(screen.getByTestId('chart-card-sales-trend')).toHaveTextContent(/Net sales by month, 2026/));
  });

  it('invalidating the dashboard prefix refetches the filtered query', async () => {
    const { calls } = serve();
    const { client } = await renderWithQuery(<DashboardRoute />);
    await waitFor(() => expect(screen.getByTestId('dashboard-period-previous')).not.toBeDisabled());
    await fireEvent.press(screen.getByTestId('dashboard-period-month'));
    await waitFor(() => expect(lastQuery(calls)).toBe('period=month'));
    const before = calls.length;

    await act(() => client.invalidateQueries({ queryKey: queryKeys.dashboard }));

    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    expect(lastQuery(calls)).toBe('period=month');
  });

  it('a 422 on date resets the filter to Day / today', async () => {
    const { calls } = serve({ rejectDates: true });
    await renderWithQuery(<DashboardRoute />);
    await waitFor(() => expect(screen.getByTestId('dashboard-period-previous')).not.toBeDisabled());

    await fireEvent.press(screen.getByTestId('dashboard-period-previous'));
    await waitFor(() => expect(calls.some((call) => call.query.get('date') === '2026-10-13')).toBe(true));

    await waitFor(() => expect(screen.getByTestId('dashboard-period-label')).toHaveTextContent('Today'));
    expect(screen.getByTestId('dashboard-period-next')).toBeDisabled();
    expect(screen.getByTestId('dashboard-sales')).toBeOnTheScreen();
  });
});
