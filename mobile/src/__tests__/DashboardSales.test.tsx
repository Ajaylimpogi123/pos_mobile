/**
 * The dashboard's real `sales` section (contract → Core Sale → Dashboard:
 * `sales`, App → Dashboard): today's figures, the honest "No sales yet today"
 * state, and the charts for the last 7 days and the payment methods. Only
 * real figures: nothing is sampled or filled in.
 */
import { fireEvent, screen, within } from '@testing-library/react-native';

import DashboardRoute from '@/app/(app)/index';
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

  it('says "No sales yet today" with every figure at 0, and leaves out the empty charts and list', async () => {
    serve(managerDashboard({ sales: noSales() }));

    await renderWithQuery(<DashboardRoute />);

    const empty = await screen.findByTestId('dashboard-sales-empty');
    expect(empty).toHaveTextContent(/No sales yet today/);
    expect(screen.getByTestId('dashboard-sales')).not.toHaveTextContent(/₱/);
    expect(screen.queryByTestId('chart-card-sales-trend')).toBeNull();
    expect(screen.queryByTestId('chart-card-payments')).toBeNull();
    expect(screen.queryByTestId('dashboard-top-products')).toBeNull();
  });

  it('still shows the last 7 days when only earlier days had sales', async () => {
    const earlier = noSales();
    earlier.last_7_days[3] = { date: '2026-09-22', orders_count: 2, net_sales_cents: 12000 };
    serve(managerDashboard({ sales: earlier }));

    await renderWithQuery(<DashboardRoute />);

    expect(await screen.findByTestId('dashboard-sales-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('chart-card-sales-trend')).toBeOnTheScreen();
    expect(screen.queryByTestId('chart-card-payments')).toBeNull();
  });
});

describe('Sales charts', () => {
  it('net sales, last 7 days: one series (no legend), peso end labels, a tooltip and a table', async () => {
    serve(managerDashboard({ sales: makeSales() }));
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-sales-trend-plot');
    await layoutPlot('chart-sales-trend-plot');

    expect(screen.queryByTestId('chart-sales-trend-legend')).toBeNull();
    expect(screen.getByTestId('chart-sales-trend-row-2026-09-25')).toHaveTextContent(/Today/);
    expect(screen.getByTestId('chart-sales-trend-row-2026-09-19')).toHaveTextContent(/Sat 19/);
    expect(screen.getByTestId('chart-sales-trend-label-2026-09-25')).toHaveTextContent('₱4,030.00');
    expect(screen.getByTestId('chart-sales-trend-label-2026-09-22')).toHaveTextContent('₱0.00');

    await fireEvent.press(screen.getByTestId('chart-sales-trend-row-2026-09-24'));
    const tooltip = screen.getByTestId('chart-sales-trend-tooltip');
    expect(tooltip).toHaveTextContent(/Thu, 24 Sep 2026/);
    expect(tooltip).toHaveTextContent(/Net sales₱3,310\.00/);
    expect(tooltip).toHaveTextContent(/Orders10/);

    await fireEvent.press(screen.getByTestId('chart-card-sales-trend-table-toggle'));
    expect(screen.getByTestId('chart-sales-trend-table')).toHaveTextContent(/^DayOrdersNet sales/);
    expect(screen.getByTestId('chart-sales-trend-table-row-6')).toHaveTextContent('Fri, 25 Sep 202612₱4,030.00');
  });

  it('payments today: cash then GCash, net of change, with orders in the tooltip and table', async () => {
    serve(managerDashboard({ sales: makeSales() }));
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-payments-plot');
    await layoutPlot('chart-payments-plot');

    expect(screen.getByTestId('chart-payments-row-cash')).toHaveTextContent(/Cash/);
    expect(screen.getByTestId('chart-payments-label-cash')).toHaveTextContent('₱3,000.00');
    expect(screen.getByTestId('chart-payments-label-gcash')).toHaveTextContent('₱1,030.00');

    await fireEvent.press(screen.getByTestId('chart-payments-row-gcash'));
    expect(screen.getByTestId('chart-payments-tooltip')).toHaveTextContent(/GCash.*Amount₱1,030\.00.*Orders4/);

    await fireEvent.press(screen.getByTestId('chart-card-payments-table-toggle'));
    expect(screen.getByTestId('chart-payments-table-row-0')).toHaveTextContent('Cash9₱3,000.00');
    expect(screen.getByTestId('chart-payments-table-row-1')).toHaveTextContent('GCash4₱1,030.00');
  });

  it('top products today, as the server ranks them', async () => {
    serve(managerDashboard({ sales: makeSales() }));
    await renderWithQuery(<DashboardRoute />);

    expect(await screen.findByTestId('top-product-9')).toHaveTextContent(/1Iced Tea14 sold₱450\.00/);
  });
});
