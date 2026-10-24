/**
 * Reports (`report.view`; docs/api-contract.md → Shifts & Reporting → Sales
 * reports and Screens): the date range and `group_by` in the query, the
 * totals card, the rows table, the chart for `day`, every state, and
 * **Export CSV** (the export endpoint, saved with expo-file-system, shared
 * with expo-sharing; both mocked here).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import ReportsRoute from '@/app/(app)/(admin)/reports/index';
import { clampRange, presetRange } from '@/hooks/reports/useSalesReport';
import { exportFileName, fileNameFromDisposition } from '@/services/reports';
import type { SalesReportRow } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { deferred, managerUser, renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { writtenFiles } from '@/test-utils/fileSystem';
import { makeReportRow, makeSalesReport } from '@/test-utils/shifts';
import { businessDateAt } from '@pos/core/businessDay';
import { EXPORT_NEEDS_BUILD_MESSAGE, EXPORT_WEB_MESSAGE, shareCsv } from '@/utils/csvShare';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system', () => require('@/test-utils/fileSystem').fileSystemMock);

jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

const sharing = jest.requireMock('expo-sharing') as { isAvailableAsync: jest.Mock; shareAsync: jest.Mock };
const FUTURE = '2099-09-25T01:30:00Z';
const REPORT = '/api/v1/reports/sales';
const EXPORT = '/api/v1/reports/sales/export';

function today(): string {
  return businessDateAt(Date.now(), 'Asia/Manila', '04:00');
}

function dayRows(from: string, count: number): SalesReportRow[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_unused, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    return { key: date, label: date, orders_count: index, qty: index * 2, gross_sales_cents: index * 1000, discounts_cents: 0, net_sales_cents: index * 1000, refunds_cents: 0, net_after_refunds_cents: index * 1000, refunded_qty: null };
  });
}

function csvResponse(text: string, disposition: string | null): Response {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-disposition' ? disposition : null) },
  } as unknown as Response;
}

async function renderReports() {
  const result = await renderWithQuery(<ReportsRoute />);
  await waitFor(() => expect(screen.queryByTestId('report-loading')).toBeNull());
  return result;
}

beforeEach(() => {
  writtenFiles.length = 0;
  sharing.isAvailableAsync.mockResolvedValue(true);
  sharing.shareAsync.mockClear();
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
});

describe('the report', () => {
  it('asks for the last 7 days by day; shows the totals, the chart and one row per day', async () => {
    const from = presetRange('last7', today()).from;
    const { calls } = routeFetch([
      {
        method: 'GET',
        path: REPORT,
        reply: (call) =>
          mockResponse(200, { data: makeSalesReport({ from, to: today(), group_by: 'day', rows: dayRows(from, 7) }), meta: { truncated: false } }),
      },
    ]);
    await renderReports();

    expect(calls[0].query.get('from')).toBe(from);
    expect(calls[0].query.get('to')).toBe(today());
    expect(calls[0].query.get('group_by')).toBe('day');
    expect(screen.getByTestId('report-total-net')).toHaveTextContent('₱88,800.00');
    expect(screen.getByTestId('report-total-orders')).toHaveTextContent('812');
    expect(screen.getByTestId('report-chart-card')).toBeOnTheScreen();
    expect(screen.getByTestId(`report-row-${from}`)).toBeOnTheScreen();
    expect(screen.getByTestId('report-summary')).toHaveTextContent('7 days');

    // "View as table" swaps the chart for its table.
    await fireEvent.press(screen.getByTestId('report-chart-card-table-toggle'));
    expect(screen.getByText('View as chart')).toBeOnTheScreen();
  });

  it('group_by product: rows by label; payment rows show "—" for qty, gross and discounts; no chart', async () => {
    const { calls } = routeFetch([
      {
        method: 'GET',
        path: REPORT,
        reply: (call) =>
          call.query.get('group_by') === 'payment'
            ? mockResponse(200, {
                data: makeSalesReport({
                  group_by: 'payment',
                  rows: [makeReportRow({ key: 'cash', label: 'cash', qty: null, gross_sales_cents: null, discounts_cents: null, net_sales_cents: 700000 })],
                }),
              })
            : mockResponse(200, { data: makeSalesReport() }),
      },
    ]);
    await renderReports();
    await fireEvent.press(screen.getByTestId('report-group-product'));
    expect(await screen.findByText('Iced Tea')).toBeOnTheScreen();
    expect(screen.queryByTestId('report-chart-card')).toBeNull();
    expect(screen.getByTestId('report-row-9-net')).toHaveTextContent('₱10,800.00');

    await fireEvent.press(screen.getByTestId('report-group-payment'));
    const row = await screen.findByTestId('report-row-cash');
    expect(within(row).getAllByText('—')).toHaveLength(3);
    expect(calls.map((call) => call.query.get('group_by'))).toEqual(['day', 'product', 'payment']);
  });

  it('presets and the From / To steppers change the range (never past today)', async () => {
    const { calls } = routeFetch([{ method: 'GET', path: REPORT, reply: () => mockResponse(200, { data: makeSalesReport() }) }]);
    await renderReports();
    await fireEvent.press(screen.getByTestId('report-preset-today'));
    await waitFor(() => expect(calls[calls.length - 1].query.get('from')).toBe(today()));
    expect(screen.getByTestId('report-to-later')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('report-from-earlier'));
    await waitFor(() => expect(calls[calls.length - 1].query.get('from')).not.toBe(today()));
    expect(screen.getByTestId('report-summary')).toHaveTextContent('2 days');
  });

  it('loading, then "No sales in this range" (the filters stay); an error shows Retry', async () => {
    const reply = deferred<Response>();
    routeFetch([{ method: 'GET', path: REPORT, reply: () => reply.promise }]);
    await renderWithQuery(<ReportsRoute />);
    expect(screen.getByTestId('report-loading')).toBeOnTheScreen();
    const empty = makeSalesReport({ totals: { orders_count: 0, items_sold: 0, gross_sales_cents: 0, discounts_cents: 0, net_sales_cents: 0, vat_amount_cents: 0, voids_count: 0, voids_cents: 0, refunds_count: 0, refunds_cents: 0, net_after_refunds_cents: 0, sc_pwd_orders_count: 0, sc_pwd_vat_relief_cents: 0, sc_pwd_discount_cents: 0, service_charge_cents: 0 }, rows: [] });
    await act(async () => reply.resolve(mockResponse(200, { data: empty })));
    expect(await screen.findByTestId('report-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('report-filters')).toBeOnTheScreen();
    expect(screen.getByTestId('report-export')).toBeDisabled();

    routeFetch([{ method: 'GET', path: REPORT, reply: () => mockResponse(500, { message: 'Server Error.' }) }]);
    await fireEvent.press(screen.getByTestId('report-group-cashier'));
    expect(await screen.findByTestId('report-error')).toBeOnTheScreen();
    routeFetch([{ method: 'GET', path: REPORT, reply: () => mockResponse(200, { data: makeSalesReport({ group_by: 'cashier' }) }) }]);
    await fireEvent.press(screen.getByTestId('report-retry'));
    expect(await screen.findByTestId('report-totals')).toBeOnTheScreen();
  });

  it('meta.truncated: says only the first 500 rows show; a long day range uses the table, not the chart', async () => {
    routeFetch([
      { method: 'GET', path: REPORT, reply: () => mockResponse(200, { data: makeSalesReport({ group_by: 'day', rows: dayRows('2026-01-01', 40) }), meta: { truncated: true } }) },
    ]);
    await renderReports();
    expect(screen.getByTestId('report-truncated')).toBeOnTheScreen();
    expect(screen.getByTestId('report-chart-too-long')).toBeOnTheScreen();
  });
});

describe('Export CSV', () => {
  it('downloads the export with the same query, writes it to the cache (with a BOM) and opens the share sheet', async () => {
    const { calls } = routeFetch([
      { method: 'GET', path: REPORT, reply: () => mockResponse(200, { data: makeSalesReport() }) },
      { method: 'GET', path: EXPORT, reply: () => csvResponse('key,label\n9,Iced Tea\nTOTAL,\n', 'attachment; filename="sales-day-2026-09-20-2026-09-26.csv"') },
    ]);
    await renderReports();
    await fireEvent.press(screen.getByTestId('report-export'));
    await waitFor(() => expect(sharing.shareAsync).toHaveBeenCalled());

    const exportCall = calls.find((call) => call.path === EXPORT)!;
    const reportCall = calls.find((call) => call.path === REPORT)!;
    expect(exportCall.query.toString()).toBe(reportCall.query.toString());
    // Through the shared client: its headers, 401 handling and typed errors apply.
    expect((exportCall.init.headers as Record<string, string>).Accept).toBe('application/json');
    expect(writtenFiles).toEqual([{ name: 'sales-day-2026-09-20-2026-09-26.csv', content: '﻿key,label\n9,Iced Tea\nTOTAL,\n' }]);
    expect(sharing.shareAsync).toHaveBeenCalledWith('file:///cache/sales-day-2026-09-20-2026-09-26.csv', expect.objectContaining({ mimeType: 'text/csv' }));
    expect(screen.queryByTestId('report-export-message')).toBeNull();
  });

  it('an export error (JSON) is shown; a device that can\'t share says so', async () => {
    routeFetch([
      { method: 'GET', path: REPORT, reply: () => mockResponse(200, { data: makeSalesReport() }) },
      { method: 'GET', path: EXPORT, reply: () => mockResponse(422, { message: 'The to field must be a date after or equal to from.', errors: { to: ['The to field must be a date after or equal to from.'] } }) },
    ]);
    await renderReports();
    await fireEvent.press(screen.getByTestId('report-export'));
    expect(await screen.findByText('The to field must be a date after or equal to from.')).toBeOnTheScreen();

    routeFetch([
      { method: 'GET', path: REPORT, reply: () => mockResponse(200, { data: makeSalesReport() }) },
      { method: 'GET', path: EXPORT, reply: () => csvResponse('a,b\n', null) },
    ]);
    sharing.isAvailableAsync.mockResolvedValue(false);
    await fireEvent.press(screen.getByTestId('report-export'));
    expect(await screen.findByText("This device can't share files.")).toBeOnTheScreen();
    expect(writtenFiles[0].name).toMatch(/^sales-day-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('helpers', () => {
  it('shareCsv degrades on the web and in a build without the native modules', async () => {
    expect(await shareCsv('a.csv', 'x', { platform: 'web', load: () => null })).toEqual({ ok: false, message: EXPORT_WEB_MESSAGE });
    expect(await shareCsv('a.csv', 'x', { platform: 'android', load: () => null })).toEqual({ ok: false, message: EXPORT_NEEDS_BUILD_MESSAGE });
  });

  it('file names: from Content-Disposition when safe, else the contract pattern', () => {
    expect(fileNameFromDisposition('attachment; filename="sales-product-2026-09-01-2026-09-26.csv"')).toBe('sales-product-2026-09-01-2026-09-26.csv');
    expect(fileNameFromDisposition('attachment; filename="../../etc/passwd"')).toBeNull();
    expect(exportFileName({ from: '2026-09-01', to: '2026-09-26', group_by: 'cashier' })).toBe('sales-cashier-2026-09-01-2026-09-26.csv');
  });

  it('ranges stay valid: to ≥ from, at most 366 days, never past today', () => {
    expect(clampRange({ from: '2026-09-27', to: '2026-09-26' }, '2026-09-26', 'from')).toEqual({ from: '2026-09-26', to: '2026-09-26' });
    expect(clampRange({ from: '2026-09-20', to: '2026-09-19' }, '2026-09-26', 'to')).toEqual({ from: '2026-09-19', to: '2026-09-19' });
    expect(clampRange({ from: '2025-09-25', to: '2026-09-26' }, '2026-09-26', 'from')).toEqual({ from: '2025-09-25', to: '2026-09-25' });
    expect(presetRange('thisMonth', '2026-09-26')).toEqual({ from: '2026-09-01', to: '2026-09-26' });
  });
});
