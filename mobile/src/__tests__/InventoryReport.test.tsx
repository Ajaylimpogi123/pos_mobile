/**
 * Reports → Inventory (docs/api-contract.md → Inventory (v1 completion) →
 * GET /api/v1/reports/inventory, its CSV export, and Device rules → Reports):
 * the `Sales | Inventory` switch over one shared date range, the category and
 * status filters, the totals card, the rows table (wide and phone portrait),
 * the truncated banner, every state, and **Export CSV** shared as
 * `Export inventory report` (expo-file-system and expo-sharing are mocked).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import ReportsRoute from '@/app/(app)/(admin)/reports/index';
import { presetRange } from '@/hooks/reports/useReportRange';
import { inventoryExportFileName } from '@/services/reports';
import { useSessionStore } from '@/stores/session';
import { mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { makeCategory, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { writtenFiles } from '@/test-utils/fileSystem';
import { makeInventoryReport, makeInventoryReportRow } from '@/test-utils/inventory';
import { makeSalesReport } from '@/test-utils/shifts';
import { businessDateAt } from '@/utils/businessDay';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system', () => require('@/test-utils/fileSystem').fileSystemMock);

jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

const sharing = jest.requireMock('expo-sharing') as { isAvailableAsync: jest.Mock; shareAsync: jest.Mock };
const FUTURE = '2099-09-25T01:30:00Z';
const SALES = '/api/v1/reports/sales';
const INVENTORY_REPORT = '/api/v1/reports/inventory';
const EXPORT = '/api/v1/reports/inventory/export';

function today(): string {
  return businessDateAt(Date.now(), 'Asia/Manila', '04:00');
}

function csvResponse(text: string, disposition: string | null): Response {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-disposition' ? disposition : null) },
  } as unknown as Response;
}

const salesRoute: Route = { method: 'GET', path: SALES, reply: () => mockResponse(200, { data: makeSalesReport(), meta: { truncated: false } }) };
const categoriesRoute: Route = {
  method: 'GET',
  path: '/api/v1/admin/categories',
  reply: () => mockResponse(200, page([makeCategory({ id: 3, name: 'Drinks' })], null, '/api/v1/admin/categories')),
};

function reportRoute(reply?: Route['reply']): Route {
  return { method: 'GET', path: INVENTORY_REPORT, reply: reply ?? (() => mockResponse(200, { data: makeInventoryReport(), meta: { truncated: false } })) };
}

function reportCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.path === INVENTORY_REPORT);
}

async function openInventory() {
  await renderWithQuery(<ReportsRoute />);
  await waitFor(() => expect(screen.queryByTestId('report-loading')).toBeNull());
  await fireEvent.press(screen.getByTestId('reports-kind-inventory'));
  await waitFor(() => expect(screen.queryByTestId('inventory-report-loading')).toBeNull());
}

beforeEach(() => {
  writtenFiles.length = 0;
  sharing.isAvailableAsync.mockResolvedValue(true);
  sharing.shareAsync.mockClear();
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
});

afterEach(() => {
  resetWindowSize();
});

describe('the inventory report', () => {
  it('the switch shows the Inventory view over the same range: totals and every column on a wide screen', async () => {
    const { calls } = routeFetch([salesRoute, categoriesRoute, reportRoute()]);
    await openInventory();

    const [first] = reportCalls(calls);
    const range = presetRange('last7', today());
    expect(first.query.get('from')).toBe(range.from);
    expect(first.query.get('to')).toBe(today());
    expect(first.query.has('category_id')).toBe(false);
    expect(first.query.has('status')).toBe(false);
    expect(screen.queryByTestId('report-list')).toBeNull();

    expect(screen.getByTestId('inventory-total-value')).toHaveTextContent('₱12,500.00');
    expect(screen.getByTestId('inventory-total-tracked')).toHaveTextContent('24');
    expect(screen.getByTestId('inventory-total-low')).toHaveTextContent('3');
    expect(screen.getByTestId('inventory-total-out')).toHaveTextContent('1');
    expect(screen.getByTestId('inventory-total-received')).toHaveTextContent('48');
    expect(screen.getByTestId('inventory-total-sold')).toHaveTextContent('97');
    expect(screen.getByTestId('inventory-total-wasted')).toHaveTextContent('3');

    const row = 'inventory-report-row-9';
    for (const [field, value] of [
      ['opening_qty', '35'],
      ['received', '24'],
      ['sold', '50'],
      ['returned', '1'],
      ['wasted', '1'],
      ['adjusted', '0'],
      ['closing_qty', '9'],
    ]) {
      expect(screen.getByTestId(`${row}-${field}`)).toHaveTextContent(value);
    }
    expect(screen.getByTestId(`${row}-status`)).toHaveTextContent('Low');
    expect(screen.getByTestId(`${row}-value`)).toHaveTextContent('₱108.00');
    expect(screen.getByTestId('inventory-report-summary')).toHaveTextContent('7 days · 1 product');
  });

  it('phone portrait: name, closing qty and status only', async () => {
    routeFetch([salesRoute, categoriesRoute, reportRoute()]);
    await act(async () => setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height));
    await openInventory();

    expect(screen.getByTestId('inventory-report-row-9-closing_qty')).toHaveTextContent('9');
    expect(screen.getByTestId('inventory-report-row-9-status')).toHaveTextContent('Low');
    expect(screen.queryByTestId('inventory-report-row-9-opening_qty')).toBeNull();
    expect(screen.queryByTestId('inventory-report-row-9-value')).toBeNull();

    // Rotating re-lays out in place with every column back (tablet landscape).
    await act(async () => setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height));
    expect(screen.getByTestId('inventory-report-row-9-opening_qty')).toHaveTextContent('35');
  });

  it('filters: a category chip → category_id, a status → status; the range is shared with Sales', async () => {
    const { calls } = routeFetch([salesRoute, categoriesRoute, reportRoute()]);
    await renderWithQuery(<ReportsRoute />);
    await waitFor(() => expect(screen.queryByTestId('report-loading')).toBeNull());
    await fireEvent.press(screen.getByTestId('report-preset-today'));
    await fireEvent.press(screen.getByTestId('reports-kind-inventory'));

    await waitFor(() => expect(reportCalls(calls)).toHaveLength(1));
    expect(reportCalls(calls)[0].query.get('from')).toBe(today());
    expect(reportCalls(calls)[0].query.get('to')).toBe(today());

    await fireEvent.press(await screen.findByTestId('inventory-report-category-3'));
    await waitFor(() => expect(reportCalls(calls).at(-1)?.query.get('category_id')).toBe('3'));
    await fireEvent.press(screen.getByTestId('inventory-report-status-alerts'));
    await waitFor(() => expect(reportCalls(calls).at(-1)?.query.get('status')).toBe('alerts'));
    await fireEvent.press(screen.getByTestId('inventory-report-status-all'));
    await waitFor(() => expect(reportCalls(calls).at(-1)?.query.has('status')).toBe(false));
  });

  it('meta.truncated shows the banner', async () => {
    routeFetch([
      salesRoute,
      categoriesRoute,
      reportRoute(() => mockResponse(200, { data: makeInventoryReport({ rows: [makeInventoryReportRow(), makeInventoryReportRow({ product_id: 10, name: 'Cola' })] }), meta: { truncated: true } })),
    ]);
    await openInventory();

    expect(screen.getByTestId('inventory-report-truncated')).toHaveTextContent(/Showing the first 500 products/);
  });

  it('empty with filters offers Clear filters; an error shows Retry', async () => {
    let reply: 'error' | 'empty' = 'error';
    const { calls } = routeFetch([
      salesRoute,
      categoriesRoute,
      reportRoute(() =>
        reply === 'error' ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, { data: makeInventoryReport({ rows: [] }), meta: { truncated: false } }),
      ),
    ]);
    await openInventory();

    expect(screen.getByTestId('inventory-report-error')).toHaveTextContent(/Server Error\./);
    reply = 'empty';
    await fireEvent.press(screen.getByTestId('inventory-report-retry'));
    expect(await screen.findByTestId('inventory-report-empty')).toHaveTextContent(/No tracked products/);

    await fireEvent.press(screen.getByTestId('inventory-report-status-low'));
    await waitFor(() => expect(screen.getByTestId('inventory-report-empty')).toHaveTextContent(/No products match these filters/));
    await fireEvent.press(screen.getByTestId('inventory-report-clear'));
    await waitFor(() => expect(reportCalls(calls).at(-1)?.query.has('status')).toBe(false));
  });
});

describe('Export CSV', () => {
  it('downloads the export with the same query, writes it (BOM) and shares it as "Export inventory report"', async () => {
    const { calls } = routeFetch([
      salesRoute,
      categoriesRoute,
      reportRoute(),
      {
        method: 'GET',
        path: EXPORT,
        reply: () => csvResponse('product_id,name\r\n9,Iced Tea\r\n', 'attachment; filename="inventory-2026-09-21-2026-09-27.csv"'),
      },
    ]);
    await openInventory();
    await fireEvent.press(screen.getByTestId('inventory-report-status-low'));
    await waitFor(() => expect(reportCalls(calls).at(-1)?.query.get('status')).toBe('low'));

    await fireEvent.press(screen.getByTestId('inventory-report-export'));
    await waitFor(() => expect(sharing.shareAsync).toHaveBeenCalledTimes(1));

    const exportCall = calls.find((call) => call.path === EXPORT)!;
    expect(exportCall.query.get('status')).toBe('low');
    expect(exportCall.query.get('from')).toBe(presetRange('last7', today()).from);
    expect(writtenFiles).toEqual([{ name: 'inventory-2026-09-21-2026-09-27.csv', content: '﻿product_id,name\r\n9,Iced Tea\r\n' }]);
    expect(sharing.shareAsync).toHaveBeenCalledWith(
      'file:///cache/inventory-2026-09-21-2026-09-27.csv',
      expect.objectContaining({ mimeType: 'text/csv', dialogTitle: 'Export inventory report' }),
    );
  });

  it('without Content-Disposition the file is inventory-<from>-<to>.csv; an export error (JSON) is shown', async () => {
    let fail = false;
    routeFetch([
      salesRoute,
      categoriesRoute,
      reportRoute(),
      {
        method: 'GET',
        path: EXPORT,
        reply: () =>
          fail
            ? mockResponse(422, { message: 'The to field must be a date after or equal to from.', errors: { to: ['The to field must be a date after or equal to from.'] } })
            : csvResponse('x', null),
      },
    ]);
    await openInventory();

    await fireEvent.press(screen.getByTestId('inventory-report-export'));
    await waitFor(() => expect(sharing.shareAsync).toHaveBeenCalledTimes(1));
    const range = presetRange('last7', today());
    expect(writtenFiles[0].name).toBe(inventoryExportFileName(range));
    expect(writtenFiles[0].name).toBe(`inventory-${range.from}-${range.to}.csv`);

    fail = true;
    await fireEvent.press(screen.getByTestId('inventory-report-export'));
    expect(
      within(await screen.findByTestId('inventory-report-export-message')).getByText('The to field must be a date after or equal to from.'),
    ).toBeOnTheScreen();
  });

  it('the sales export still shares as "Export sales report"', async () => {
    routeFetch([
      salesRoute,
      { method: 'GET', path: '/api/v1/reports/sales/export', reply: () => csvResponse('x', 'attachment; filename="sales-day-2026-09-21-2026-09-27.csv"') },
    ]);
    await renderWithQuery(<ReportsRoute />);
    await waitFor(() => expect(screen.queryByTestId('report-loading')).toBeNull());

    await fireEvent.press(screen.getByTestId('report-export'));
    await waitFor(() => expect(sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(sharing.shareAsync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ dialogTitle: 'Export sales report' }));
  });
});
