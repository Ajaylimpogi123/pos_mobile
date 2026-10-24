/**
 * The dashboard's real `sales` section (contract → Core Sale → Dashboard:
 * `sales`, App → Dashboard): today's figures, the honest "No sales yet today"
 * state, and the charts for the last 7 days and the payment methods. Only
 * real figures: nothing is sampled or filled in.
 */
import { fireEvent, screen, within } from '@testing-library/react-native';

import DashboardRoute from '@/app/(app)/index';
import { colors, statAccent } from '@/constants/theme';
import type { Dashboard } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { managerUser, renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { managerDashboard } from '@/test-utils/dashboard';
import { makeSales, noSales } from '@/test-utils/sale';

const FUTURE = '2099-09-25T01:30:00Z';

function serve(dashboard: Dashboard) {
  return routeFetch([{ method: 'GET', path: '/api/v1/dashboard', reply: () => mockResponse(200, { data: dashboard }) }]);
}

/** Charts size themselves with onLayout: give a plot a width, as a device would. */
async function layoutPlot(testID: string, width = 400) {
  await fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 240 } } });
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
});

describe('Sales today', () => {
  it('renders the real figures first in the grid', async () => {
    serve(managerDashboard({ sales: makeSales() }));

    await renderWithQuery(<DashboardRoute />);
    const card = await screen.findByTestId('dashboard-sales');

    expect(card).toHaveTextContent(/Sales today/);
    expect(card).toHaveTextContent(/Fri, 25 Sep 2026/);
    expect(screen.getByTestId('dashboard-sales-net')).toHaveTextContent('₱4,030.00');
    expect(screen.getByTestId('sales-orders-value')).toHaveTextContent('12');
    expect(screen.getByTestId('sales-items-value')).toHaveTextContent('34');
    expect(screen.getByTestId('sales-average-value')).toHaveTextContent('₱335.83');
    expect(screen.getByTestId('sales-gross-value')).toHaveTextContent('₱4,120.00');
    expect(screen.getByTestId('sales-discounts-value')).toHaveTextContent('₱90.00');
    expect(screen.getByTestId('sales-vat-value')).toHaveTextContent('₱382.50');
    expect(screen.queryByTestId('dashboard-sales-empty')).toBeNull();

    const cells = within(screen.getByTestId('dashboard-grid'))
      .getAllByTestId(/^dashboard-grid-cell-/)
      .map((cell) => cell.props.testID);
    expect(cells.slice(0, 5)).toEqual([
      'dashboard-grid-cell-sales',
      'dashboard-grid-cell-insights',
      'dashboard-grid-cell-sales-trend',
      'dashboard-grid-cell-payments',
      'dashboard-grid-cell-top-products',
    ]);
  });

  it('says "No sales yet today." on the running day with every figure at 0, and leaves out the empty charts and list', async () => {
    serve(managerDashboard({ sales: noSales() }));

    await renderWithQuery(<DashboardRoute />);

    const empty = await screen.findByTestId('dashboard-sales-empty');
    expect(empty).toHaveTextContent(/No sales yet today\./);
    expect(screen.getByTestId('dashboard-sales')).not.toHaveTextContent(/₱/);
    expect(screen.queryByTestId('chart-card-sales-trend')).toBeNull();
    expect(screen.queryByTestId('chart-card-payments')).toBeNull();
    expect(screen.queryByTestId('dashboard-top-products')).toBeNull();
  });

  it('still shows the trend (last 7 days) when only earlier days had sales', async () => {
    const earlier = noSales();
    earlier.trend.buckets[3] = { start: '2026-09-22', orders_count: 2, net_sales_cents: 12000 };
    serve(managerDashboard({ sales: earlier }));

    await renderWithQuery(<DashboardRoute />);

    expect(await screen.findByTestId('dashboard-sales-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('chart-card-sales-trend')).toBeOnTheScreen();
    expect(screen.queryByTestId('chart-card-payments')).toBeNull();
  });
});

describe('Stat cards and stock alerts', () => {
  it('leads with Net sales (green), Orders (blue), Average ticket (purple) and Low or out of stock (orange); the rest stay neutral', async () => {
    serve(
      managerDashboard({
        sales: makeSales(),
        insights: [
          { key: 'stock_out', severity: 'critical', title: '2 products out', message: 'Restock.', count: 2, action: 'inventory.alerts' },
          { key: 'stock_low', severity: 'warning', title: '3 products low', message: 'Reorder.', count: 3, action: 'inventory.alerts' },
        ],
      }),
    );
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('kpi-tiles');

    expect(screen.getByTestId('kpi-net-sales-value')).toHaveTextContent('₱4,030.00');
    expect(screen.getByTestId('kpi-net-sales-value')).toHaveStyle({ color: statAccent.sales.color });
    expect(screen.getByTestId('kpi-orders-value')).toHaveStyle({ color: statAccent.orders.color });
    expect(screen.getByTestId('kpi-average-value')).toHaveStyle({ color: statAccent.average.color });
    expect(screen.getByTestId('kpi-stock-value')).toHaveTextContent('5');
    expect(screen.getByTestId('kpi-stock-value')).toHaveStyle({ color: statAccent.stock.color });
    expect(screen.getByTestId('kpi-products-value')).toHaveStyle({ color: colors.text });

    expect(screen.getByTestId('stock-alerts-products-out')).toHaveTextContent('Out 2');
    expect(screen.getByTestId('stock-alerts-products-low')).toHaveTextContent('Low 3');
    expect(screen.getByTestId('stock-alerts-products-open')).toBeOnTheScreen();
    expect(screen.queryByTestId('stock-alerts-ingredients-open')).toBeNull();
  });
});

describe('Sales charts', () => {
  it('net sales, last 7 days: one green area series (no legend), a tooltip and a table', async () => {
    serve(managerDashboard({ sales: makeSales() }));
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-sales-trend-plot');
    await layoutPlot('chart-sales-trend-plot');

    expect(screen.queryByTestId('chart-sales-trend-legend')).toBeNull();
    expect(screen.getByTestId('chart-sales-trend-line-net')).toBeOnTheScreen();
    expect(screen.getByTestId('chart-sales-trend-area-net').props.fillOpacity).toBe(0.18);
    expect(screen.getByTestId('chart-card-sales-trend')).toHaveTextContent(/Net sales, last 7 days/);
    expect(screen.getByTestId('chart-card-sales-trend')).toHaveTextContent(/The 7 business days ending Today, in pesos\./);
    expect(screen.getByTestId('chart-sales-trend-canvas')).toHaveTextContent(/Sat.*Sun.*Mon.*Tue.*Wed.*Thu.*Fri/);

    // Columns: Sat 19 … Fri 25 (from `trend.buckets`); Thu 24 is the 6th.
    await fireEvent.press(screen.getByTestId('chart-sales-trend-column-5'));
    const tooltip = screen.getByTestId('chart-sales-trend-tooltip');
    expect(tooltip).toHaveTextContent(/Thu, 24 Sep 2026/);
    expect(tooltip).toHaveTextContent(/Net sales₱3,310\.00/);

    await fireEvent.press(screen.getByTestId('chart-card-sales-trend-table-toggle'));
    expect(screen.getByTestId('chart-sales-trend-table')).toHaveTextContent(/^DayOrdersNet sales/);
    expect(screen.getByTestId('chart-sales-trend-table-row-6')).toHaveTextContent('Fri, 25 Sep 202612₱4,030.00');
  });

  it('payment methods: one stacked bar (cash then GCash) with a legend of amounts and shares, a tooltip and a table', async () => {
    serve(managerDashboard({ sales: makeSales() }));
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-payments-plot');
    await layoutPlot('chart-payments-plot');

    expect(screen.getByTestId('chart-payments-row-period')).toHaveTextContent(/Today/);
    expect(screen.getByTestId('chart-card-payments')).toHaveTextContent(/Today, takings net of change\./);
    expect(screen.getByTestId('chart-payments-label-period')).toHaveTextContent('₱4,030.00');
    expect(screen.getByTestId('chart-payments-bar-period-cash')).toBeOnTheScreen();
    expect(screen.getByTestId('chart-payments-bar-period-gcash')).toBeOnTheScreen();
    expect(screen.getByTestId('chart-payments-legend')).toHaveTextContent(/Cash.*₱3,000\.00 · 74%.*GCash.*₱1,030\.00 · 26%/);

    await fireEvent.press(screen.getByTestId('chart-payments-row-period'));
    expect(screen.getByTestId('chart-payments-tooltip')).toHaveTextContent(/GCash₱1,030\.00 · 26% · 4 orders/);

    await fireEvent.press(screen.getByTestId('chart-card-payments-table-toggle'));
    expect(screen.getByTestId('chart-payments-table-row-0')).toHaveTextContent('Cash9₱3,000.00');
    expect(screen.getByTestId('chart-payments-table-row-1')).toHaveTextContent('GCash4₱1,030.00');
  });

  it('top products today, as the server ranks them', async () => {
    serve(managerDashboard({ sales: makeSales() }));
    await renderWithQuery(<DashboardRoute />);

    expect(await screen.findByTestId('top-product-9')).toHaveTextContent(/1Iced Tea14 sold₱450\.00/);
    expect(screen.getByTestId('dashboard-top-products')).toHaveTextContent(/Today, by quantity sold\./);
  });
});
