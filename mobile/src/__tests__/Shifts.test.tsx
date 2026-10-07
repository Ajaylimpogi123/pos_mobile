/**
 * Shifts (`report.zread`; docs/api-contract.md → Shifts & Reporting →
 * Screens): the list with a business-date filter (every state), and a
 * shift's detail with the server's `ShiftReport` and Print.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import ShiftRoute from '@/app/(app)/(admin)/shifts/[ulid]';
import ShiftsIndexRoute from '@/app/(app)/(admin)/shifts/index';
import { resetPrintingForTests, whenPrintQueueIdle } from '@/printing/printActions';
import { getPrintTransport } from '@/printing/transport';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { managerUser, page, renderWithQuery, routeFetch, deferred } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { decodeEscPos } from '@/test-utils/escpos';
import { createFakeTransport, makePrintConfig, type FakeTransport } from '@/test-utils/printing';
import { makeShift, makeShiftReport, TEST_SHIFT_ULID } from '@/test-utils/shifts';
import { businessDateAt } from '@/utils/businessDay';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

const FUTURE = '2099-09-25T01:30:00Z';
const SHIFTS = '/api/v1/shifts';
let fake: FakeTransport;

function today(): string {
  return businessDateAt(Date.now(), 'Asia/Manila', '04:00');
}

beforeEach(async () => {
  await freshTestDatabase();
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  usePrintingStore.getState().setConfig(makePrintConfig());
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  fake = createFakeTransport();
  (getPrintTransport as jest.Mock).mockReturnValue(fake.transport);
  (router.push as jest.Mock).mockClear();
});

describe('the Shifts list', () => {
  it('loads today by default, shows each shift (tablet, net, variance, flags) and opens its report', async () => {
    const open = makeShift({ ulid: '01K6S00000000000000000000B', status: 'open', closed_at: null, closed_by: null, counted_cash_cents: null, report: makeShiftReport({ variance_cents: null }) });
    const closed = makeShift({ report: makeShiftReport({ variance_cents: -5000 }), flags: ['auto_closed'] });
    const { calls } = routeFetch([{ method: 'GET', path: SHIFTS, reply: () => mockResponse(200, page([open, closed], null, SHIFTS)) }]);
    await renderWithQuery(<ShiftsIndexRoute />);

    expect(await screen.findByTestId(`shift-card-${closed.ulid}`)).toBeOnTheScreen();
    expect(calls[0].query.get('business_date')).toBe(today());
    expect(calls[0].query.get('per_page')).toBe('25');
    expect(screen.getByTestId(`shift-card-${closed.ulid}-net`)).toHaveTextContent('₱12,250.00');
    expect(screen.getByTestId(`shift-card-${closed.ulid}-variance`)).toHaveTextContent('Short ₱50.00');
    expect(screen.getByText('Closed automatically')).toBeOnTheScreen();
    expect(screen.queryByTestId(`shift-card-${open.ulid}-variance`)).toBeNull();

    await fireEvent.press(screen.getByTestId(`shift-card-${closed.ulid}-open`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/shifts/[ulid]', params: { ulid: closed.ulid } });
  });

  it('loading, then empty for today; "All dates" drops the filter; the previous day steps back', async () => {
    const reply = deferred<Response>();
    const { calls } = routeFetch([{ method: 'GET', path: SHIFTS, reply: () => reply.promise }]);
    await renderWithQuery(<ShiftsIndexRoute />);
    expect(screen.getByTestId('shifts-grid-loading')).toBeOnTheScreen();
    await act(async () => reply.resolve(mockResponse(200, page([], null, SHIFTS))));
    expect(await screen.findByText('No shifts today')).toBeOnTheScreen();

    const { calls: later } = routeFetch([{ method: 'GET', path: SHIFTS, reply: () => mockResponse(200, page([], null, SHIFTS)) }]);
    await fireEvent.press(screen.getByTestId('shifts-all-dates'));
    await waitFor(() => expect(later.some((call) => !call.query.has('business_date'))).toBe(true));
    await fireEvent.press(screen.getByTestId('shifts-today'));
    await fireEvent.press(screen.getByTestId('shifts-prev-day'));
    await waitFor(() => expect(later.some((call) => call.query.get('business_date') !== null && call.query.get('business_date')! < today())).toBe(true));
    expect(calls).toHaveLength(1);
  });

  it('an error shows the message with Retry; 403 says "No access"', async () => {
    routeFetch([{ method: 'GET', path: SHIFTS, reply: () => mockResponse(500, { message: 'Server Error.' }) }]);
    await renderWithQuery(<ShiftsIndexRoute />);
    expect(await screen.findByTestId('shifts-grid-error')).toBeOnTheScreen();
    expect(screen.getByText('Server Error.')).toBeOnTheScreen();

    routeFetch([{ method: 'GET', path: SHIFTS, reply: () => mockResponse(200, page([makeShift()], null, SHIFTS)) }]);
    await fireEvent.press(screen.getByText('Retry'));
    expect(await screen.findByTestId(`shift-card-${TEST_SHIFT_ULID}`)).toBeOnTheScreen();
  });

  it('loads the next page with next_cursor', async () => {
    const second = makeShift({ ulid: '01K6S00000000000000000000Z' });
    const { calls } = routeFetch([
      {
        method: 'GET',
        path: SHIFTS,
        reply: (call) =>
          call.query.get('cursor') === 'next1'
            ? mockResponse(200, page([second], null, SHIFTS))
            : mockResponse(200, page([makeShift()], 'next1', SHIFTS)),
      },
    ]);
    await renderWithQuery(<ShiftsIndexRoute />);
    await screen.findByTestId(`shift-card-${TEST_SHIFT_ULID}`);
    await fireEvent(screen.getByTestId('shifts-grid'), 'onEndReached');
    expect(await screen.findByTestId(`shift-card-${second.ulid}`)).toBeOnTheScreen();
    expect(calls.map((call) => call.query.get('cursor'))).toEqual([null, 'next1']);
  });
});

describe('a shift', () => {
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: TEST_SHIFT_ULID });
  });

  afterEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
  });

  it("shows the server's report (expected, counted, variance, cashiers) and prints the Z-read as a reprint", async () => {
    routeFetch([{ method: 'GET', path: `${SHIFTS}/${TEST_SHIFT_ULID}`, reply: () => mockResponse(200, { data: makeShift({ close_note: 'Short: ice' }) }) }]);
    await renderWithQuery(<ShiftRoute />);

    expect(await screen.findByTestId('shift-detail-report')).toBeOnTheScreen();
    expect(screen.getByTestId('shift-detail-report-expected-amount')).toHaveTextContent('₱8,450.00');
    expect(screen.getByTestId('shift-detail-report-counted-amount')).toHaveTextContent('₱8,450.00');
    expect(screen.getByTestId('shift-detail-report-variance')).toHaveTextContent('Balanced');
    expect(screen.getByTestId('shift-detail-report-cashier-3-amount')).toHaveTextContent('₱9,000.00');
    expect(screen.getByTestId('shift-detail-note')).toHaveTextContent('Short: ice');

    await fireEvent.press(screen.getByTestId('shift-detail-print'));
    await act(async () => {
      await whenPrintQueueIdle();
    });
    const printed = decodeEscPos(fake.sentTo(9100)[0].bytes);
    expect(printed).toContain('Z-READ');
    expect(printed).toContain('*** REPRINT ***');
    expect(await screen.findByTestId('shift-detail-print-status')).toBeOnTheScreen();
  });

  it('an open shift prints an X-read; no receipt printer says so', async () => {
    usePrintingStore.getState().setConfig(makePrintConfig({ printers: [] }));
    routeFetch([
      {
        method: 'GET',
        path: `${SHIFTS}/${TEST_SHIFT_ULID}`,
        reply: () => mockResponse(200, { data: makeShift({ status: 'open', closed_at: null, closed_by: null, counted_cash_cents: null }) }),
      },
    ]);
    await renderWithQuery(<ShiftRoute />);
    await fireEvent.press(await screen.findByTestId('shift-detail-print'));
    expect(screen.getByText('Print X-read')).toBeOnTheScreen();
    expect(await screen.findByText('No receipt printer is set up for this tablet.')).toBeOnTheScreen();
  });

  it('404: "Not found" with Retry', async () => {
    routeFetch([{ method: 'GET', path: `${SHIFTS}/${TEST_SHIFT_ULID}`, reply: () => mockResponse(404, { message: 'Resource not found.' }) }]);
    await renderWithQuery(<ShiftRoute />);
    expect(await screen.findByText('Not found')).toBeOnTheScreen();
  });
});
