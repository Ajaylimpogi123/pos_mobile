/**
 * Reports → Purchasing and the inventory report's Ingredients kind
 * (docs/api-contract.md → Ingredients, Recipes & Purchasing §D, §I, §L): the
 * `Sales | Inventory | Purchasing` switch by permission, the filters, the
 * totals, the rows (wide and phone layouts), every state, and **Export CSV**
 * (`Export purchasing report`; the ingredient export sends `kind`).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import ReportsRoute from '@/app/(app)/(admin)/reports/index';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { makeCategory, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { writtenFiles } from '@/test-utils/fileSystem';
import { makeInventoryReport } from '@/test-utils/inventory';
import { makePurchasingReport } from '@/test-utils/purchasing';
import { makeSalesReport } from '@/test-utils/shifts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system', () => require('@/test-utils/fileSystem').fileSystemMock);

jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

const sharing = jest.requireMock('expo-sharing') as { shareAsync: jest.Mock };
const FUTURE = '2099-09-25T01:30:00Z';
const PURCHASING = '/api/v1/reports/purchasing';
const INVENTORY = '/api/v1/reports/inventory';

function csvResponse(text: string, disposition: string | null): Response {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-disposition' ? disposition : null) },
  } as unknown as Response;
}

const baseRoutes: Route[] = [
  { method: 'GET', path: '/api/v1/reports/sales', reply: () => mockResponse(200, { data: makeSalesReport(), meta: { truncated: false } }) },
  { method: 'GET', path: '/api/v1/admin/categories', reply: () => mockResponse(200, page([makeCategory()], null, '/api/v1/admin/categories')) },
  { method: 'GET', path: PURCHASING, reply: () => mockResponse(200, { data: makePurchasingReport(), meta: { truncated: false } }) },
];

function callsTo(calls: FetchCall[], path: string): FetchCall[] {
  return calls.filter((call) => call.path === path);
}

beforeEach(() => {
  writtenFiles.length = 0;
  sharing.shareAsync.mockClear();
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
});

afterEach(() => {
  resetWindowSize();
});

async function openPurchasing() {
  await renderWithQuery(<ReportsRoute />);
  await fireEvent.press(screen.getByTestId('reports-kind-purchasing'));
  await screen.findByTestId('purchasing-report-totals');
}

describe('Purchasing report', () => {
  it('shows the totals and a row per PR item', async () => {
    const { calls } = routeFetch(baseRoutes);
    await openPurchasing();
    expect(screen.getByTestId('purchasing-total-ordered')).toHaveTextContent('₱2,400.00');
    expect(screen.getByTestId('purchasing-total-received')).toHaveTextContent('₱1,200.00');
    expect(screen.getByTestId('purchasing-total-remaining')).toHaveTextContent('₱1,200.00');
    expect(screen.getByTestId('purchasing-total-prs')).toHaveTextContent('1');
    expect(screen.getByTestId('purchasing-total-pos-approved')).toHaveTextContent('1');
    expect(screen.getByTestId('purchasing-report-row-0-decision')).toHaveTextContent(/Approved/);
    expect(screen.getByTestId('purchasing-report-row-1-decision')).toHaveTextContent(/Declined/);
    expect(screen.getByTestId('purchasing-report-row-0-received-cents')).toHaveTextContent('₱1,200.00');
    expect(screen.getByTestId('purchasing-report-row-1-received-cents')).toHaveTextContent('—');
    const query = callsTo(calls, PURCHASING)[0]?.query;
    expect(query?.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('wide screens show the PO and line status; phones in portrait a compact row', async () => {
    routeFetch(baseRoutes);
    setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);
    await openPurchasing();
    expect(screen.getByTestId('purchasing-report-row-0-po')).toHaveTextContent('PO-MAIN-2026-00001');
    expect(screen.getByTestId('purchasing-report-row-0-line-status')).toHaveTextContent(/Partial/);

    await act(async () => setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height));
    expect(screen.queryByTestId('purchasing-report-row-0-po')).toBeNull();
    expect(screen.getByTestId('purchasing-report-row-0-decision')).toBeOnTheScreen();
  });

  it('sends the filters', async () => {
    const { calls } = routeFetch(baseRoutes);
    await openPurchasing();
    await fireEvent.press(screen.getByTestId('purchasing-report-decision-declined'));
    await waitFor(() => expect(callsTo(calls, PURCHASING).at(-1)?.query.get('decision')).toBe('declined'));
    await fireEvent.press(screen.getByTestId('purchasing-report-po-approved'));
    await waitFor(() => expect(callsTo(calls, PURCHASING).at(-1)?.query.get('po_status')).toBe('approved'));
    await fireEvent.press(screen.getByTestId('purchasing-report-receiving-over_received'));
    await waitFor(() => expect(callsTo(calls, PURCHASING).at(-1)?.query.get('receiving_status')).toBe('over_received'));
  });

  it('an empty range, and an error with Retry', async () => {
    let fail = true;
    routeFetch([
      ...baseRoutes.filter((route) => route.path !== PURCHASING),
      {
        method: 'GET',
        path: PURCHASING,
        reply: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, { data: makePurchasingReport({ rows: [] }), meta: { truncated: false } })),
      },
    ]);
    await renderWithQuery(<ReportsRoute />);
    await fireEvent.press(screen.getByTestId('reports-kind-purchasing'));
    expect(await screen.findByTestId('purchasing-report-error')).toHaveTextContent(/Server Error\./);
    fail = false;
    await fireEvent.press(screen.getByTestId('purchasing-report-error-retry'));
    expect(await screen.findByTestId('purchasing-report-empty')).toHaveTextContent(/No purchase requests in this range/);
  });

  it('exports the CSV with the same query and shares it as "Export purchasing report"', async () => {
    const { calls } = routeFetch([
      ...baseRoutes,
      { method: 'GET', path: `${PURCHASING}/export`, reply: () => csvResponse('﻿pr_no\r\nPR-MAIN-2026-00001\r\n', 'attachment; filename="purchasing-2026-09-28-2026-09-28.csv"') },
    ]);
    await openPurchasing();
    await fireEvent.press(screen.getByTestId('purchasing-report-export'));
    await waitFor(() => expect(sharing.shareAsync).toHaveBeenCalledTimes(1));
    const exportCall = callsTo(calls, `${PURCHASING}/export`)[0] as FetchCall;
    expect(exportCall.query.get('from')).toBe(callsTo(calls, PURCHASING)[0]?.query.get('from'));
    expect(writtenFiles[0]?.name).toBe('purchasing-2026-09-28-2026-09-28.csv');
    expect(sharing.shareAsync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ dialogTitle: 'Export purchasing report' }));
  });

  it('purchase.approve without report.view gets only the Purchasing view', async () => {
    useSessionStore.getState().setSignedIn({ ...cashierUser, permissions: ['purchase.approve'] }, FUTURE);
    const { calls } = routeFetch(baseRoutes);
    await renderWithQuery(<ReportsRoute />);
    await screen.findByTestId('purchasing-report-totals');
    expect(screen.queryByTestId('reports-kind')).toBeNull();
    expect(callsTo(calls, '/api/v1/reports/sales')).toHaveLength(0);
  });
});

describe('Inventory report: Ingredients kind', () => {
  const ingredientReport = {
    from: '2026-09-28',
    to: '2026-09-28',
    totals: { tracked: 12, low: 2, out: 1, stock_value_cents: 140000 },
    rows: [
      {
        ingredient_id: 5,
        name: 'Flour',
        base_unit: 'g',
        opening_qty: '5000.000',
        received: '25000.000',
        used: '240.000',
        returned: '0.000',
        wasted: '0.000',
        adjusted: '0.000',
        closing_qty: '29760.000',
        reorder_level: '5000.000',
        status: 'in_stock',
        avg_cost: '4.666667',
        stock_value_cents: 138880,
        value_in_cents: 120000,
        value_out_cents: 1120,
      },
    ],
  };

  it('switches to Ingredients: sends kind=ingredients, shows base-unit rows, and exports with the kind', async () => {
    const { calls } = routeFetch([
      ...baseRoutes,
      {
        method: 'GET',
        path: INVENTORY,
        reply: (call) =>
          call.query.get('kind') === 'ingredients'
            ? mockResponse(200, { data: ingredientReport, meta: { truncated: false } })
            : mockResponse(200, { data: makeInventoryReport(), meta: { truncated: false } }),
      },
      { method: 'GET', path: `${INVENTORY}/export`, reply: () => csvResponse('﻿ingredient_id\r\n', null) },
    ]);
    setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);
    await renderWithQuery(<ReportsRoute />);
    await fireEvent.press(screen.getByTestId('reports-kind-inventory'));
    await screen.findByTestId('inventory-report-totals');
    expect(callsTo(calls, INVENTORY)[0]?.query.get('kind')).toBeNull();

    await fireEvent.press(screen.getByTestId('inventory-report-kind-ingredients'));
    expect(await screen.findByTestId('ingredient-report-row-5-closing_qty')).toHaveTextContent('29,760');
    expect(screen.getByTestId('ingredient-report-row-5-used')).toHaveTextContent('240');
    expect(screen.getByTestId('ingredient-total-value')).toHaveTextContent('₱1,400.00');
    expect(callsTo(calls, INVENTORY).at(-1)?.query.get('kind')).toBe('ingredients');

    await fireEvent.press(screen.getByTestId('ingredient-report-export'));
    await waitFor(() => expect(sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(callsTo(calls, `${INVENTORY}/export`)[0]?.query.get('kind')).toBe('ingredients');
    expect(writtenFiles[0]?.name).toMatch(/^inventory-ingredients-/);
  });
});
