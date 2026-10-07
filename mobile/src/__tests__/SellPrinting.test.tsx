/**
 * Sell screen → printing (docs/api-contract.md → Printing → Screens): the
 * failure banner ("Kitchen ticket #17 didn't print: Kitchen isn't
 * responding." with Retry / Dismiss, or Retry all), the printer status pill
 * from a reachability probe on focus (at most once a minute), and "Sync now"
 * refreshing the print config.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import SellRoute from '@/app/(app)/(pos)/sell/index';
import { printRepository } from '@/db/printRepository';
import type { PrintJobInsert } from '@/db/schema';
import { probePrinters, resetPrintingForTests, sellPrinters, startPrinting, whenPrintQueueIdle } from '@/printing/printActions';
import { getPrintTransport } from '@/printing/transport';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { routeFetch } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { seedOpenShift } from '@/test-utils/shifts';
import { BAR, createFakeTransport, KITCHEN, makePrintConfig, type FakeTransport } from '@/test-utils/printing';
import { makeOrder } from '@/test-utils/sale';
import { syncPage } from '@/test-utils/sync';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

const FUTURE = '2099-09-25T01:30:00Z';
const getTransport = getPrintTransport as jest.Mock;
const getNetworkStateAsync = jest.requireMock('expo-network').getNetworkStateAsync as jest.Mock;
let fake: FakeTransport;

function failedJob(id: string, overrides: Partial<PrintJobInsert> = {}): PrintJobInsert {
  const now = new Date().toISOString();
  return {
    id,
    order_ulid: makeOrder().ulid,
    queue_no: 17,
    kind: 'kitchen',
    printer_id: KITCHEN.id,
    printer_name: 'Kitchen',
    printer_role: 'kitchen',
    copy_no: 1,
    copies: 1,
    is_reprint: false,
    order_json: JSON.stringify(makeOrder()),
    item_ids: '[101,102]',
    status: 'failed',
    attempts: 3,
    error: "Kitchen isn't responding.",
    dismissed: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await whenPrintQueueIdle();
  });
}

async function renderSell() {
  await render(<SellRoute />);
  await waitFor(() => expect(screen.queryByTestId('sell-loading')).toBeNull());
}

beforeEach(async () => {
  await freshTestDatabase();
  // Phase 6: sales need an open shift on the tablet.
  seedOpenShift();
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  usePrintingStore.getState().setConfig(makePrintConfig());
  useSyncStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  getNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
  fake = createFakeTransport();
  getTransport.mockReturnValue(fake.transport);
  routeFetch([]);
});

afterEach(async () => {
  await settle();
});

describe('failure banner', () => {
  it('names the failed ticket and its reason; Retry sends it again and the banner goes', async () => {
    await printRepository.insertJobs([failedJob('01K62Z0000000000000000000A')]);
    await startPrinting();
    await renderSell();

    const banner = screen.getByTestId('print-failure-message');
    expect(within(banner).getByText("Kitchen ticket #17 didn't print: Kitchen isn't responding.")).toBeOnTheScreen();
    expect(screen.getByTestId('print-failure-retry')).toHaveTextContent(/Retry$/);

    await fireEvent.press(screen.getByTestId('print-failure-retry'));
    await settle();
    expect(fake.sentTo(9101)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId('print-failure-banner')).toBeNull());
  });

  it('several failures: "Retry all"; Dismiss hides them but keeps them failed', async () => {
    await printRepository.insertJobs([
      failedJob('01K62Z0000000000000000000A'),
      failedJob('01K62Z0000000000000000000B', { printer_id: BAR.id, printer_name: 'Bar', printer_role: 'bar', item_ids: '[103]', error: "Bar isn't responding." }),
    ]);
    await startPrinting();
    await renderSell();

    expect(within(screen.getByTestId('print-failure-message')).getByText("2 print jobs didn't print.")).toBeOnTheScreen();
    expect(screen.getByText(/Bar ticket #17 didn't print: Bar isn't responding\./)).toBeOnTheScreen();
    expect(screen.getByTestId('print-failure-retry')).toHaveTextContent(/Retry all$/);

    await fireEvent.press(screen.getByTestId('print-failure-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('print-failure-banner')).toBeNull());
    expect((await printRepository.failedJobs()).length).toBe(0);
    expect((await printRepository.getJob('01K62Z0000000000000000000A'))?.status).toBe('failed');
  });

  it('several failures: "Retry all" sends every one', async () => {
    await printRepository.insertJobs([
      failedJob('01K62Z0000000000000000000A'),
      failedJob('01K62Z0000000000000000000B', { printer_id: BAR.id, printer_name: 'Bar', printer_role: 'bar', item_ids: '[103]' }),
    ]);
    await startPrinting();
    await renderSell();

    await fireEvent.press(screen.getByTestId('print-failure-retry'));
    await settle();
    expect(fake.sentTo(9101)).toHaveLength(1);
    expect(fake.sentTo(9102)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId('print-failure-banner')).toBeNull());
  });
});

describe('printer status pill', () => {
  it("probes this tablet's receipt printer and the kitchen and bar printers on focus, and names the one not responding", async () => {
    fake.setReachable(9101, false);
    await renderSell();

    await waitFor(() => expect(screen.getByTestId('printer-status')).toHaveTextContent(/Kitchen not responding$/));
    expect(fake.probes.map((target) => target.port).sort()).toEqual([9100, 9101, 9102]);
  });

  it('says "Printers ready" when all respond, and probes at most once a minute', async () => {
    await renderSell();
    await waitFor(() => expect(screen.getByTestId('printer-status')).toHaveTextContent(/Printers ready$/));
    expect(fake.probes).toHaveLength(3);

    // Sell gaining focus again within the minute doesn't probe again.
    await act(async () => {
      await probePrinters(sellPrinters(usePrintingStore.getState().config, null));
    });
    expect(fake.probes).toHaveLength(3);
  });

  it('in Expo Go: "Printing unavailable", and nothing is probed', async () => {
    getTransport.mockReturnValue(jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport').getPrintTransport());
    await renderSell();
    expect(screen.getByTestId('printer-status')).toHaveTextContent(/Printing unavailable$/);
    expect(fake.probes).toHaveLength(0);
  });
});

it('"Sync now" also refreshes the print config (GET /api/v1/print-config)', async () => {
  const renamed = makePrintConfig({ printers: [{ ...KITCHEN, name: 'Hot Kitchen' }] });
  const { calls } = routeFetch([
    { method: 'GET', path: '/api/v1/sync/catalogue', reply: () => mockResponse(200, syncPage()) },
    { method: 'GET', path: '/api/v1/print-config', reply: () => mockResponse(200, { data: renamed }) },
  ]);
  await renderSell();

  await fireEvent.press(screen.getByTestId('sell-sync-now'));
  await waitFor(() => expect(usePrintingStore.getState().config).toEqual(renamed));
  expect(calls.map((call) => call.path)).toContain('/api/v1/print-config');
  expect(await printRepository.readConfig('http://192.168.1.50:8000', 1)).toEqual(renamed);
});
