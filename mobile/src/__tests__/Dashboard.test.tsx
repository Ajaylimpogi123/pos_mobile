import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import DashboardRoute from '@/app/(app)/index';
import type { Dashboard } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { managerUser, renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { cashierDashboard, managerDashboard } from '@/test-utils/dashboard';

const FUTURE = '2026-09-25T01:30:00Z';

/** Inventory (v1 completion): the `stock_out` / `stock_low` insights. */
const STOCK_INSIGHTS: Dashboard['insights'] = [
  {
    key: 'stock_out',
    severity: 'critical',
    title: '1 product is out of stock',
    message: 'Restock it or mark it unavailable.',
    count: 1,
    action: 'inventory.alerts',
  },
  { key: 'stock_low', severity: 'warning', title: '3 products are running low', message: 'Plan a delivery.', count: 3, action: 'inventory.alerts' },
];

function serve(dashboard: Dashboard) {
  return routeFetch([
    { method: 'GET', path: '/api/v1/dashboard', reply: () => mockResponse(200, { data: dashboard }) },
  ]);
}

/** Charts size themselves with onLayout: give a plot a width, as a device would. */
async function layoutPlot(testID: string, width = 400) {
  await fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 240 } } });
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.push as jest.Mock).mockClear();
});

afterEach(() => {
  resetWindowSize();
});

describe('Dashboard (manager)', () => {
  it('calls GET /api/v1/dashboard and shows the header: name, business date, branch, updated time', async () => {
    const { calls } = serve(managerDashboard());

    await renderWithQuery(<DashboardRoute />);

    await screen.findByTestId('dashboard-grid');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /api/v1/dashboard']);
    expect(screen.getByTestId('dashboard-header')).toHaveTextContent(/Mia Manager/);
    expect(screen.getByTestId('dashboard-date')).toHaveTextContent(/Thu, 24 Sep 2026$/);
    expect(screen.getByTestId('dashboard-branch')).toHaveTextContent(/Main Branch$/);
    expect(screen.getByTestId('dashboard-updated')).toHaveTextContent(/Updated \d{1,2}:\d{2} (AM|PM)$/);
  });

  it('renders the KPI tiles with correct formatting', async () => {
    serve(managerDashboard());

    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('kpi-tiles');

    expect(screen.getByTestId('kpi-products-value')).toHaveTextContent('4');
    expect(screen.getByTestId('kpi-products-detail')).toHaveTextContent('of 5 products');
    expect(screen.getByTestId('kpi-margin-value')).toHaveTextContent('55.0%');
    expect(screen.getByTestId('kpi-margin-detail')).toHaveTextContent('Target 30%');
    expect(screen.getByTestId('kpi-staff-value')).toHaveTextContent('4');
    expect(screen.getByTestId('kpi-staff-detail')).toHaveTextContent('of 5 staff');
    expect(screen.getByTestId('kpi-customers-value')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-customers-detail')).toHaveTextContent('+2 this week');
    // The last entry of changes_by_day (today).
    expect(screen.getByTestId('kpi-changes')).toHaveTextContent(/Changes today/);
    expect(screen.getByTestId('kpi-changes')).not.toHaveTextContent(/Menu/);
    expect(screen.getByTestId('kpi-changes-value')).toHaveTextContent('14');
  });

  it('shows "—" for a null average margin (no product has cost data)', async () => {
    const base = managerDashboard();
    serve(managerDashboard({ catalog: { ...base.catalog!, average_margin_bps: null } }));

    await renderWithQuery(<DashboardRoute />);

    expect(await screen.findByTestId('kpi-margin-value')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-margin-detail')).toHaveTextContent('No products with cost data');
  });

  it('renders insights with severity icon + text label, and each action opens its screen', async () => {
    serve(managerDashboard());

    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('dashboard-insights');

    expect(screen.getByTestId('insight-products_without_cost-severity')).toHaveTextContent('Warning');
    expect(screen.getByTestId('insight-categories_empty-severity')).toHaveTextContent('Info');
    expect(screen.getByTestId('insight-products_without_cost')).toHaveTextContent(/1 product has no cost/);
    expect(screen.getByTestId('insight-products_without_cost')).toHaveTextContent(/Add a cost/);

    await fireEvent.press(screen.getByTestId('insight-products_without_cost-action'));
    expect(router.push).toHaveBeenLastCalledWith('/menu/products');
    await fireEvent.press(screen.getByTestId('insight-staff_without_pin-action'));
    expect(router.push).toHaveBeenLastCalledWith('/staff');
    await fireEvent.press(screen.getByTestId('insight-categories_empty-action'));
    expect(router.push).toHaveBeenLastCalledWith('/menu/categories');
  });

  it('shows no action button for a null action, or a destination the user cannot open', async () => {
    const base = managerDashboard();
    useSessionStore.getState().setSignedIn({ ...managerUser, permissions: ['report.view'] }, FUTURE);
    serve(
      managerDashboard({
        insights: [
          { ...base.insights[0], key: 'no_action', action: null },
          { ...base.insights[0], key: 'needs_product_manage' },
        ],
      }),
    );

    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('insight-no_action');

    expect(screen.queryByTestId('insight-no_action-action')).toBeNull();
    expect(screen.queryByTestId('insight-needs_product_manage-action')).toBeNull();
  });

  it('stock insights (Inventory): inventory.alerts opens Inventory with the Low & out filter', async () => {
    serve(managerDashboard({ insights: STOCK_INSIGHTS }));

    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('insight-stock_out');
    expect(screen.getByTestId('insight-stock_out-severity')).toHaveTextContent('Critical');
    await fireEvent.press(screen.getByTestId('insight-stock_out-action'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/inventory', params: { status: 'alerts' } });
    await fireEvent.press(screen.getByTestId('insight-stock_low-action'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/inventory', params: { status: 'alerts' } });
  });

  it('ingredient and purchasing insights (Ingredients, Recipes & Purchasing) open their screens', async () => {
    serve(
      managerDashboard({
        insights: [
          { key: 'ingredients_out', severity: 'critical', title: '1 ingredient is out of stock', message: 'Buy it.', count: 1, action: 'inventory.ingredients.alerts' },
          // Q-029: the confirmed action keys.
          { key: 'purchase_requests_pending', severity: 'warning', title: '2 requests need a decision', message: 'Decide them.', count: 2, action: 'purchasing.requests.pending' },
          { key: 'purchase_orders_to_receive', severity: 'info', title: '1 order to receive', message: 'Receive it.', count: 1, action: 'purchasing.orders.to_receive' },
        ],
      }),
    );

    await renderWithQuery(<DashboardRoute />);
    await fireEvent.press(await screen.findByTestId('insight-ingredients_out-action'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/inventory/ingredients', params: { status: 'alerts' } });
    await fireEvent.press(screen.getByTestId('insight-purchase_requests_pending-action'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/purchasing/requests', params: { view: 'decision' } });
    await fireEvent.press(screen.getByTestId('insight-purchase_orders_to_receive-action'));
    expect(router.push).toHaveBeenLastCalledWith('/purchasing/receiving');
  });

  it('stock insights: inventory.adjust alone opens Inventory', async () => {
    useSessionStore.getState().setSignedIn({ ...managerUser, permissions: ['inventory.adjust'] }, FUTURE);
    serve(managerDashboard({ insights: STOCK_INSIGHTS }));

    await renderWithQuery(<DashboardRoute />);
    expect(await screen.findByTestId('insight-stock_low-action')).toBeOnTheScreen();
  });

  it('stock insights: no button without inventory.adjust or report.view', async () => {
    useSessionStore.getState().setSignedIn({ ...managerUser, permissions: ['product.manage'] }, FUTURE);
    serve(managerDashboard({ insights: STOCK_INSIGHTS }));

    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('insight-stock_low');
    expect(screen.queryByTestId('insight-stock_low-action')).toBeNull();
  });

  it('shows "All clear" when there are no insights', async () => {
    serve(managerDashboard({ insights: [] }));

    await renderWithQuery(<DashboardRoute />);

    expect(await screen.findByTestId('dashboard-insights-empty')).toHaveTextContent(/All clear — nothing needs attention.$/);
  });

  it('leaves the Sales card out when `sales` is null (no `report.view`), and never shows sales figures', async () => {
    serve(managerDashboard());

    await renderWithQuery(<DashboardRoute />);

    await screen.findByTestId('dashboard-grid');
    expect(screen.queryByTestId('dashboard-sales')).toBeNull();
    expect(screen.queryByTestId('chart-card-sales-trend')).toBeNull();
    expect(screen.queryByTestId('chart-card-payments')).toBeNull();
    expect(screen.queryByTestId('dashboard-top-products')).toBeNull();
  });

  it('lists lowest margins (tappable to edit), recent logins and recent changes', async () => {
    serve(managerDashboard());

    await renderWithQuery(<DashboardRoute />);
    const row = await screen.findByTestId('low-margin-9');

    expect(row).toHaveTextContent(/Iced Tea/);
    expect(row).toHaveTextContent(/Drinks · ₱35\.00 · cost ₱28\.00/);
    expect(screen.getByTestId('low-margin-9-margin')).toHaveTextContent('20.0%');
    await fireEvent.press(row);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/menu/products/[id]', params: { id: '9' } });

    expect(screen.getByTestId('recent-login-3')).toHaveTextContent(/Carla Cashier/);
    expect(screen.getByTestId('recent-login-3')).toHaveTextContent(/Cashier/);
    expect(screen.getByTestId('recent-change-88')).toHaveTextContent(/Updated product "Egg with Rice"/);
    expect(screen.getByTestId('recent-change-88')).toHaveTextContent(/Marco Manager/);
  });
});

describe('Dashboard charts', () => {
  it('products by category: stacked Available + Unavailable segments, "(inactive)" label, tooltip', async () => {
    serve(managerDashboard());
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-products-plot');
    await layoutPlot('chart-products-plot');

    // Breakfast: 2 available + 1 unavailable → two segments.
    expect(screen.getByTestId('chart-products-bar-1-available')).toBeOnTheScreen();
    expect(screen.getByTestId('chart-products-bar-1-unavailable')).toBeOnTheScreen();
    // Drinks: all available → no unavailable segment. Desserts: empty → no bar at all.
    expect(screen.getByTestId('chart-products-bar-2-available')).toBeOnTheScreen();
    expect(screen.queryByTestId('chart-products-bar-2-unavailable')).toBeNull();
    expect(screen.queryByTestId('chart-products-bar-3-available')).toBeNull();
    expect(screen.getByTestId('chart-products-row-3')).toHaveTextContent(/Desserts \(inactive\)/);
    expect(screen.getByTestId('chart-products-label-1')).toHaveTextContent('2/3');
    // Legend above the plot for 2 series.
    expect(screen.getByTestId('chart-products-legend')).toHaveTextContent(/Available.*Unavailable/);

    await fireEvent.press(screen.getByTestId('chart-products-row-1'));
    const tooltip = screen.getByTestId('chart-products-tooltip');
    expect(tooltip).toHaveTextContent(/Breakfast/);
    expect(tooltip).toHaveTextContent(/Available2/);
    expect(tooltip).toHaveTextContent(/Unavailable1/);
    expect(tooltip).toHaveTextContent(/Total3/);
  });

  it('products by category: "View as table" shows the numbers', async () => {
    serve(managerDashboard());
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-card-products');

    await fireEvent.press(screen.getByTestId('chart-card-products-table-toggle'));

    const table = screen.getByTestId('chart-products-table');
    expect(table).toHaveTextContent(/CategoryAvailableUnavailableTotal/);
    expect(screen.getByTestId('chart-products-table-row-0')).toHaveTextContent('Breakfast213');
    expect(screen.getByTestId('chart-products-table-row-2')).toHaveTextContent('Desserts (inactive)000');
    expect(screen.queryByTestId('chart-products-plot')).toBeNull();
  });

  it('margin by category: labelled bar ends, "No cost data" for null, and a 30% target line', async () => {
    serve(managerDashboard());
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-margin-plot');
    await layoutPlot('chart-margin-plot');

    expect(screen.getByTestId('chart-margin-label-1')).toHaveTextContent('55.0%');
    expect(screen.getByTestId('chart-margin-label-2')).toHaveTextContent('20.0%');
    expect(screen.getByTestId('chart-margin-label-3')).toHaveTextContent('No cost data');
    expect(screen.getByTestId('chart-margin-reference')).toHaveTextContent('30% target');
    // A single series needs no legend box.
    expect(screen.queryByTestId('chart-margin-legend')).toBeNull();
    expect(screen.getByTestId('chart-margin-plot').props.accessibilityLabel).toMatch(
      /Average margin by category, target 30%\. Breakfast: 55\.0%\. Drinks: 20\.0%\. Desserts \(inactive\): no cost data\./,
    );

    await fireEvent.press(screen.getByTestId('chart-card-margin-table-toggle'));
    expect(screen.getByTestId('chart-margin-table-row-2')).toHaveTextContent('Desserts (inactive)No cost data');
  });

  it('staff by role: zero-count roles are in the legend but draw no slice; total in the centre', async () => {
    serve(managerDashboard());
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-staff-plot');
    await layoutPlot('chart-staff-plot', 300);

    expect(screen.getByTestId('chart-staff-slice-owner')).toBeOnTheScreen();
    expect(screen.getByTestId('chart-staff-slice-manager')).toBeOnTheScreen();
    expect(screen.queryByTestId('chart-staff-slice-cashier')).toBeNull();
    expect(screen.getByTestId('chart-staff-legend-cashier')).toHaveTextContent('Cashier0');
    expect(screen.getByTestId('chart-staff-legend-manager')).toHaveTextContent('Manager4');
    expect(screen.getByTestId('chart-staff-total')).toHaveTextContent('5');

    await fireEvent.press(screen.getByTestId('chart-staff-legend-manager'));
    expect(screen.getByTestId('chart-staff-tooltip')).toHaveTextContent(/Manager.*Count4.*Share80%/);

    await fireEvent.press(screen.getByTestId('chart-card-staff-table-toggle'));
    expect(screen.getByTestId('chart-staff-table-row-2')).toHaveTextContent('Cashier0');
    expect(screen.getByTestId('chart-staff-table-row-3')).toHaveTextContent('Total5');
  });

  it('activity: two series on ONE shared y-axis, weekday labels, legend with today, tooltip per day', async () => {
    serve(managerDashboard());
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-activity-plot');
    await layoutPlot('chart-activity-plot', 382);

    // One set of ticks for both series: max(6, 14) → a 0–15 axis.
    const ticks = screen.getAllByTestId(/^chart-activity-ytick-/).map((tick) => tick.props.testID);
    expect(ticks).toEqual([
      'chart-activity-ytick-0',
      'chart-activity-ytick-5',
      'chart-activity-ytick-10',
      'chart-activity-ytick-15',
    ]);
    expect(screen.getByTestId('chart-activity-line-logins')).toBeOnTheScreen();
    expect(screen.getByTestId('chart-activity-line-changes')).toBeOnTheScreen();
    expect(screen.getByTestId('chart-activity-canvas')).toHaveTextContent(/FriSatSunMonTueWedThu/);
    expect(screen.getByTestId('chart-activity-legend')).toHaveTextContent(/Logins6 today.*Changes14 today/);
    expect(screen.getByTestId('chart-activity-plot').props.accessibilityLabel).toBe(
      'Activity over the last 7 days. Logins: 13 in total, 6 today. Changes: 21 in total, 14 today.',
    );

    await fireEvent.press(screen.getByTestId('chart-activity-column-6'));
    const tooltip = screen.getByTestId('chart-activity-tooltip');
    expect(tooltip).toHaveTextContent(/Thu, 24 Sep 2026/);
    expect(tooltip).toHaveTextContent(/Logins6/);
    expect(tooltip).toHaveTextContent(/Changes14/);
    expect(screen.getByTestId('chart-activity-crosshair')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('chart-card-activity-table-toggle'));
    expect(screen.getByTestId('chart-activity-table')).toHaveTextContent(/^DayLoginsChanges/);
    expect(screen.getByTestId('chart-activity-table-row-6')).toHaveTextContent('Thu, 24 Sep 2026614');
    expect(screen.getByTestId('chart-activity-table-row-0')).toHaveTextContent('Fri, 18 Sep 202600');
  });

  it('keeps a chart\'s table view when the device rotates', async () => {
    serve(managerDashboard());
    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('chart-card-activity');
    await fireEvent.press(screen.getByTestId('chart-card-activity-table-toggle'));

    await act(async () => {
      setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height);
    });

    expect(screen.getByTestId('chart-activity-table')).toBeOnTheScreen();
  });
});

describe('Dashboard (cashier)', () => {
  beforeEach(() => {
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  });

  it('renders only the permitted sections: the Customers tile and insights; null sections (Sales too) are absent', async () => {
    serve(cashierDashboard());

    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('dashboard-grid');

    expect(screen.getByTestId('kpi-customers-value')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-customers-detail')).toHaveTextContent('+3 this week');
    for (const id of ['kpi-products', 'kpi-margin', 'kpi-staff', 'kpi-changes']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    for (const id of [
      'chart-card-products',
      'chart-card-margin',
      'chart-card-staff',
      'chart-card-activity',
      'dashboard-low-margins',
      'dashboard-recent-logins',
      'dashboard-recent-changes',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    // `sales` needs `report.view`: a cashier gets `null`, so there is no Sales card at all.
    expect(screen.queryByTestId('dashboard-sales')).toBeNull();
    expect(screen.getByTestId('dashboard-insights-empty')).toBeOnTheScreen();
    // Only the present section is laid out: no empty cells.
    expect(within(screen.getByTestId('dashboard-grid')).getAllByTestId(/^dashboard-grid-cell-/)).toHaveLength(1);
  });
});

describe('Dashboard states and layout', () => {
  it('pull-to-refresh refetches GET /api/v1/dashboard', async () => {
    const { calls } = serve(managerDashboard());
    await renderWithQuery(<DashboardRoute />);
    const scroll = await screen.findByTestId('dashboard-scroll');
    expect(calls).toHaveLength(1);

    await act(async () => {
      scroll.props.refreshControl.props.onRefresh();
    });

    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('keeps the figures and shows a banner when a refresh fails', async () => {
    let fail = false;
    routeFetch([
      {
        method: 'GET',
        path: '/api/v1/dashboard',
        reply: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, { data: managerDashboard() })),
      },
    ]);
    await renderWithQuery(<DashboardRoute />);
    const scroll = await screen.findByTestId('dashboard-scroll');

    fail = true;
    await act(async () => {
      scroll.props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByTestId('dashboard-refresh-error')).toHaveTextContent(/Server Error\./);
    expect(screen.getByTestId('kpi-tiles')).toBeOnTheScreen();
  });

  it('shows an error with Retry, then the figures after retrying', async () => {
    let fail = true;
    routeFetch([
      {
        method: 'GET',
        path: '/api/v1/dashboard',
        reply: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, { data: managerDashboard() })),
      },
    ]);

    await renderWithQuery(<DashboardRoute />);

    expect(await screen.findByTestId('dashboard-error')).toHaveTextContent(/Server Error\./);
    fail = false;
    await fireEvent.press(screen.getByTestId('dashboard-error-retry'));
    expect(await screen.findByTestId('kpi-tiles')).toBeOnTheScreen();
  });

  it.each([
    ['phone portrait', REFERENCE_SIZES.phonePortrait, 2, 1],
    ['phone landscape', REFERENCE_SIZES.phoneLandscape, 3, 2],
    ['tablet portrait', REFERENCE_SIZES.tabletPortrait, 3, 2],
    ['tablet landscape', REFERENCE_SIZES.tabletLandscape, 5, 3],
  ])('%s %j: %i KPI tiles per row, %i section columns', async (_label, size, kpiColumns, sectionColumns) => {
    setWindowSize(size.width, size.height);
    serve(managerDashboard());

    await renderWithQuery(<DashboardRoute />);
    await screen.findByTestId('kpi-tiles');

    const tileWidth = screen.getByTestId('kpi-tiles-cell-products').props.style;
    expect(JSON.stringify(tileWidth)).toContain(`"width":"${(1 / kpiColumns) * 100}%"`);
    const sectionStyle = screen.getByTestId('dashboard-grid-cell-insights').props.style;
    expect(JSON.stringify(sectionStyle)).toContain(`"width":"${(1 / sectionColumns) * 100}%"`);
  });
});
