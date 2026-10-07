/**
 * The Printers module (docs/api-contract.md → Printing → Screens): the list
 * for `sale.create` or `settings.manage`, read from the cached print config
 * (so it works offline), with status dots, Test print and "Receipts from this
 * tablet"; create and edit for `settings.manage`, with a category picker that
 * labels categories routed elsewhere, and a test print before saving.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import EditPrinterRoute from '@/app/(app)/(admin)/printers/[id]';
import PrintersIndexRoute from '@/app/(app)/(admin)/printers/index';
import NewPrinterRoute from '@/app/(app)/(admin)/printers/new';
import { visibleModuleGroups } from '@/constants/modules';
import { catalogueRepository } from '@/db/catalogueRepository';
import { resetPrintingForTests, whenPrintQueueIdle } from '@/printing/printActions';
import { getPrintTransport } from '@/printing/transport';
import type { AuthUser } from '@/services/types';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { printedLines } from '@/test-utils/escpos';
import { BAR, COUNTER, createFakeTransport, KITCHEN, makePrintConfig, makePrinter, type FakeTransport } from '@/test-utils/printing';
import { viewerUser } from '@/test-utils/staff';
import { SERVER_TIME, seedMenu } from '@/test-utils/sync';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

const FUTURE = '2099-09-25T01:30:00Z';
const PRINTERS = '/api/v1/admin/printers';
const PRINT_CONFIG = '/api/v1/print-config';
const getTransport = getPrintTransport as jest.Mock;
let fake: FakeTransport;

async function settle() {
  await act(async () => {
    await whenPrintQueueIdle();
  });
}

function module(user: AuthUser, key: string) {
  return visibleModuleGroups(user)
    .flatMap((group) => group.modules)
    .find((candidate) => candidate.key === key);
}

function cardIds(): string[] {
  return screen.getAllByTestId(/^printer-card-\d+$/).map((card) => card.props.testID);
}

beforeEach(async () => {
  await freshTestDatabase();
  await catalogueRepository.replaceCatalogue(seedMenu(), { cursor: 'c1', apiOrigin: 'http://192.168.1.50:8000', serverTime: SERVER_TIME });
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  useSyncStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  fake = createFakeTransport();
  getTransport.mockReturnValue(fake.transport);
  (router.back as jest.Mock).mockClear();
  (router.push as jest.Mock).mockClear();
});

afterEach(async () => {
  await settle();
});

describe('modules', () => {
  it('Printers is ready for `sale.create` or `settings.manage`; Settings for `settings.manage` only', () => {
    expect(module(cashierUser, 'printers')).toMatchObject({ status: 'ready', route: '/printers' });
    expect(module(managerUser, 'printers')).toMatchObject({ status: 'ready' });
    expect(module({ ...viewerUser, permissions: ['settings.manage'] }, 'printers')).toMatchObject({ status: 'ready' });
    expect(module(viewerUser, 'printers')).toBeUndefined();

    expect(module(managerUser, 'settings')).toMatchObject({ status: 'ready', route: '/settings' });
    expect(module(cashierUser, 'settings')).toBeUndefined();
  });
});

describe('the list', () => {
  it('works offline from the cached config: printers by name, status dots, no editing for a cashier', async () => {
    useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
    usePrintingStore.getState().setConfig(makePrintConfig());
    usePrintingStore.getState().setConfigStatus('offline');
    fake.setReachable(9102, false);
    const { calls } = routeFetch([]);
    await renderWithQuery(<PrintersIndexRoute />);

    expect(cardIds()).toEqual(['printer-card-3', 'printer-card-1', 'printer-card-2']);
    expect(within(screen.getByTestId('printers-offline')).getByText('Offline: showing the printers saved on this tablet.')).toBeOnTheScreen();
    expect(screen.getByTestId('printer-card-2')).toHaveTextContent(/192\.168\.1\.60:9101 · 80 mm \(48 columns\)/);
    expect(screen.getByTestId('printer-card-2-default')).toHaveTextContent('Default kitchen printer');
    await waitFor(() => expect(screen.getByTestId('printer-card-3-status').props.accessibilityLabel).toBe('Status: Not responding'));
    expect(screen.getByTestId('printer-card-2-status').props.accessibilityLabel).toBe('Status: Responding');

    expect(screen.queryByTestId('printers-new')).toBeNull();
    expect(screen.queryByTestId('printer-card-2-edit')).toBeNull();
    expect(screen.queryByTestId('printers-no-default')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('Test print sends the test page to that printer and says so', async () => {
    usePrintingStore.getState().setConfig(makePrintConfig());
    routeFetch([]);
    await renderWithQuery(<PrintersIndexRoute />);

    await fireEvent.press(screen.getByTestId('printer-card-2-test'));
    const result = await screen.findByTestId('printer-card-2-test-result');
    expect(within(result).getByText('Test page sent to Kitchen. Check that it printed.')).toBeOnTheScreen();
    expect(fake.sentTo(9101)).toHaveLength(1);
    expect(printedLines(fake.sentTo(9101)[0].bytes).slice(0, 2)).toEqual(['TEST PRINT', 'Printer  Kitchen']);
  });

  it('"Receipts from this tablet" picks this tablet\'s receipt printer and remembers it on the device', async () => {
    const front = makePrinter({ id: 4, name: 'Front', role: 'cashier', port: 9103 });
    usePrintingStore.getState().setConfig(makePrintConfig({ printers: [BAR, COUNTER, front, KITCHEN] }));
    routeFetch([]);
    await renderWithQuery(<PrintersIndexRoute />);

    expect(screen.getByTestId('printer-card-1-receipts')).toBeSelected();
    expect(screen.getByTestId('printer-card-4-receipts')).not.toBeSelected();
    expect(screen.queryByTestId('printer-card-2-receipts')).toBeNull();

    await fireEvent.press(screen.getByTestId('printer-card-4-receipts'));
    expect(screen.getByTestId('printer-card-4-receipts')).toBeSelected();
    expect(screen.getByTestId('printer-card-1-receipts')).not.toBeSelected();
    expect(await secureStoreMock().getItemAsync('pos.print.receipt_printer_id')).toBe('4');
  });

  it('with nothing cached: fetches the config; an error shows Retry, which loads the list', async () => {
    let fail = true;
    routeFetch([
      {
        method: 'GET',
        path: PRINT_CONFIG,
        reply: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, { data: makePrintConfig() })),
      },
    ]);
    await renderWithQuery(<PrintersIndexRoute />);

    const error = await screen.findByTestId('printers-grid-error');
    expect(error).toHaveTextContent(/Server Error\./);
    fail = false;
    await fireEvent.press(screen.getByTestId('printers-grid-error-retry'));
    await waitFor(() => expect(cardIds()).toHaveLength(3));
  });

  it('warns when the branch has no enabled default kitchen printer (Q-005)', async () => {
    usePrintingStore.getState().setConfig(makePrintConfig({ printers: [BAR, COUNTER, { ...KITCHEN, is_default_kitchen: false }] }));
    routeFetch([]);
    await renderWithQuery(<PrintersIndexRoute />);
    expect(screen.getByTestId('printers-no-default')).toHaveTextContent(/No default kitchen printer/);
  });

  it('with no printers: a manager is offered "New printer"', async () => {
    usePrintingStore.getState().setConfig(makePrintConfig({ printers: [] }));
    routeFetch([]);
    await renderWithQuery(<PrintersIndexRoute />);

    expect(screen.getByTestId('printers-grid-empty')).toHaveTextContent(/No printers yet/);
    await fireEvent.press(screen.getByTestId('printers-grid-empty-action'));
    expect(router.push).toHaveBeenCalledWith('/printers/new');
  });
});

describe('create and edit (`settings.manage`)', () => {
  function formRoutes(extra: Parameters<typeof routeFetch>[0] = []) {
    return routeFetch([
      { method: 'GET', path: PRINTERS, reply: () => mockResponse(200, page([BAR, COUNTER, KITCHEN], null, PRINTERS)) },
      { method: 'GET', path: PRINT_CONFIG, reply: () => mockResponse(200, { data: makePrintConfig() }) },
      ...extra,
    ]);
  }

  function lastCall(calls: FetchCall[], method: string): FetchCall | undefined {
    return [...calls].reverse().find((call) => call.method === method);
  }

  it('creates a kitchen printer: categories routed elsewhere are labelled, it test-prints before saving, and POSTs exactly', async () => {
    const created = makePrinter({ id: 7, name: 'Grill', host: '192.168.1.70', category_ids: [3] });
    const { calls } = formRoutes([{ method: 'POST', path: PRINTERS, reply: () => mockResponse(201, { data: created }) }]);
    await renderWithQuery(<NewPrinterRoute />);

    await fireEvent.changeText(screen.getByTestId('printer-name'), 'Grill');
    await fireEvent.changeText(screen.getByTestId('printer-host'), '192.168.1.70');
    await waitFor(() => expect(screen.getByTestId('printer-category-3-elsewhere')).toHaveTextContent('at Bar'));
    expect(screen.getByTestId('printer-category-1-elsewhere')).toHaveTextContent('at Kitchen');

    await fireEvent.press(screen.getByTestId('printer-category-3'));
    expect(screen.queryByTestId('printer-category-3-elsewhere')).toBeNull();
    expect(screen.getByTestId('printer-category-3').props.accessibilityState).toMatchObject({ checked: true });

    // Test print before saving: the address being edited, nothing saved yet.
    await fireEvent.press(screen.getByTestId('printer-test'));
    await screen.findByTestId('printer-test-result');
    expect(fake.sent[0].target).toEqual({ host: '192.168.1.70', port: 9100 });
    expect(lastCall(calls, 'POST')).toBeUndefined();

    await fireEvent.press(screen.getByTestId('printer-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(jsonBody(lastCall(calls, 'POST') as FetchCall)).toEqual({
      name: 'Grill',
      role: 'kitchen',
      host: '192.168.1.70',
      port: 9100,
      paper_width_mm: 80,
      is_enabled: true,
      is_default_kitchen: false,
      category_ids: [3],
    });
    // The print config is synced after the change.
    await waitFor(() => expect(calls.some((call) => call.path === PRINT_CONFIG)).toBe(true));
  });

  it('checks the address before sending, and shows 422s under their fields', async () => {
    const { calls } = formRoutes([
      {
        method: 'POST',
        path: PRINTERS,
        reply: () =>
          mockResponse(422, { message: 'The name has already been taken.', errors: { name: ['The name has already been taken.'] } }),
      },
    ]);
    await renderWithQuery(<NewPrinterRoute />);

    await fireEvent.changeText(screen.getByTestId('printer-name'), 'Kitchen');
    await fireEvent.changeText(screen.getByTestId('printer-host'), 'http://192.168.1.60:9100');
    await fireEvent.changeText(screen.getByTestId('printer-port'), '0');
    await fireEvent.press(screen.getByTestId('printer-save'));
    expect(screen.getByTestId('printer-host-error')).toHaveTextContent('Enter only the IP address or host name, without http:// or a port.');
    expect(screen.getByTestId('printer-port-error')).toHaveTextContent('Enter a port from 1 to 65535 (usually 9100).');
    expect(lastCall(calls, 'POST')).toBeUndefined();

    await fireEvent.press(screen.getByTestId('printer-test'));
    expect(fake.sent).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('printer-host'), '192.168.1.60');
    await fireEvent.changeText(screen.getByTestId('printer-port'), '9101');
    await fireEvent.press(screen.getByTestId('printer-save'));
    expect(await screen.findByTestId('printer-name-error')).toHaveTextContent('The name has already been taken.');
  });

  it('edits: PATCHes only what changed (a receipt printer takes no categories and is never the default)', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '2' });
    const { calls } = formRoutes([
      { method: 'GET', path: `${PRINTERS}/2`, reply: () => mockResponse(200, { data: KITCHEN }) },
      {
        method: 'PATCH',
        path: `${PRINTERS}/2`,
        reply: () => mockResponse(200, { data: { ...KITCHEN, role: 'cashier', port: 9105, is_default_kitchen: false, category_ids: [] } }),
      },
    ]);
    await renderWithQuery(<EditPrinterRoute />);

    await fireEvent.changeText(await screen.findByTestId('printer-port'), '9105');
    await fireEvent.press(screen.getByTestId('printer-role-cashier'));
    expect(screen.queryByTestId('printer-categories')).toBeNull();
    expect(screen.queryByTestId('printer-default-kitchen')).toBeNull();
    await fireEvent.press(screen.getByTestId('printer-save'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(jsonBody(lastCall(calls, 'PATCH') as FetchCall)).toEqual({
      role: 'cashier',
      port: 9105,
      is_default_kitchen: false,
      category_ids: [],
    });
  });

  it('deletes after confirmation', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '3' });
    const { calls } = formRoutes([
      { method: 'GET', path: `${PRINTERS}/3`, reply: () => mockResponse(200, { data: BAR }) },
      { method: 'DELETE', path: `${PRINTERS}/3`, reply: () => mockResponse(204) },
    ]);
    await renderWithQuery(<EditPrinterRoute />);

    await fireEvent.press(await screen.findByTestId('printer-delete'));
    await fireEvent.press(screen.getByTestId('delete-printer-dialog-confirm'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(lastCall(calls, 'DELETE')?.path).toBe(`${PRINTERS}/3`);
  });
});
