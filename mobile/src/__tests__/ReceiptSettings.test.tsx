/**
 * Settings → receipt settings (`settings.manage`; docs/api-contract.md →
 * Printing → Admin: receipt settings, Screens): header and footer lines,
 * auto-print, copies (1–3), kitchen tickets, saved with a partial PATCH, and
 * "Print sample" on this tablet's receipt printer.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import SettingsRoute from '@/app/(app)/(admin)/settings/index';
import { resetPrintingForTests, whenPrintQueueIdle } from '@/printing/printActions';
import { getPrintTransport } from '@/printing/transport';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { printedLines } from '@/test-utils/escpos';
import { createFakeTransport, makePrintConfig, makeSettings, type FakeTransport } from '@/test-utils/printing';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

const FUTURE = '2099-09-25T01:30:00Z';
const SETTINGS = '/api/v1/admin/settings';
const getTransport = getPrintTransport as jest.Mock;
let fake: FakeTransport;

function patchCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method === 'PATCH' && call.path === SETTINGS);
}

async function openSettings(patch: Parameters<typeof mockResponse>[1] | null = null, patchStatus = 200) {
  const routes = routeFetch([
    { method: 'GET', path: SETTINGS, reply: () => mockResponse(200, { data: makeSettings() }) },
    { method: 'PATCH', path: SETTINGS, reply: () => mockResponse(patchStatus, patch) },
    { method: 'GET', path: '/api/v1/print-config', reply: () => mockResponse(200, { data: makePrintConfig() }) },
  ]);
  await renderWithQuery(<SettingsRoute />);
  await screen.findByTestId('receipt-settings-screen');
  return routes;
}

beforeEach(async () => {
  await freshTestDatabase();
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  usePrintingStore.getState().setConfig(makePrintConfig());
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  fake = createFakeTransport();
  getTransport.mockReturnValue(fake.transport);
});

afterEach(async () => {
  await act(async () => {
    await whenPrintQueueIdle();
  });
});

it('shows the saved settings, and PATCHes only what changed, then syncs the print config', async () => {
  const saved = makeSettings({
    receipt_header_lines: ['Main Branch — Makati', '123 Rizal St., Makati', 'TIN 000-123-456-000'],
    receipt_footer_lines: ['This is not an official receipt.', 'Thank you!'],
    receipt_copies: 2,
    print_kitchen_tickets: false,
    updated_at: '2026-09-25T05:00:00Z',
  });
  const { calls } = await openSettings({ data: saved });

  expect(screen.getByTestId('settings-header-0').props.value).toBe('Main Branch');
  expect(screen.getByTestId('settings-copies-value')).toHaveTextContent('1');

  await fireEvent.changeText(screen.getByTestId('settings-header-0'), 'Main Branch — Makati');
  await fireEvent.press(screen.getByTestId('settings-footer-add'));
  await fireEvent.changeText(screen.getByTestId('settings-footer-1'), '  Thank you!  ');
  await fireEvent.press(screen.getByTestId('settings-copies-plus'));
  await fireEvent(screen.getByTestId('settings-kitchen-tickets'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('settings-save'));

  const notice = await screen.findByTestId('form-notice');
  expect(within(notice).getByText('Receipt settings saved. This tablet prints with them from now on.')).toBeOnTheScreen();
  expect(patchCalls(calls)).toHaveLength(1);
  expect(jsonBody(patchCalls(calls)[0])).toEqual({
    receipt_header_lines: ['Main Branch — Makati', '123 Rizal St., Makati', 'TIN 000-123-456-000'],
    receipt_footer_lines: ['This is not an official receipt.', 'Thank you!'],
    receipt_copies: 2,
    print_kitchen_tickets: false,
  });
  await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/print-config')).toBe(true));
});

it('blocks blank lines and more than 6, and shows server 422s under the line', async () => {
  const { calls } = await openSettings(
    { message: 'The receipt_footer_lines.0 field must not be greater than 48 characters.', errors: { 'receipt_footer_lines.0': ['Too long for the printer.'] } },
    422,
  );

  await fireEvent.press(screen.getByTestId('settings-header-add'));
  await fireEvent.press(screen.getByTestId('settings-save'));
  expect(screen.getByTestId('settings-header-3-error')).toHaveTextContent('Enter text, or remove this line.');
  expect(patchCalls(calls)).toHaveLength(0);

  await fireEvent.changeText(screen.getByTestId('settings-header-3'), 'Open 7 AM – 9 PM');
  await fireEvent.press(screen.getByTestId('settings-header-add'));
  await fireEvent.changeText(screen.getByTestId('settings-header-4'), 'x');
  await fireEvent.press(screen.getByTestId('settings-header-add'));
  await fireEvent.changeText(screen.getByTestId('settings-header-5'), 'y');
  expect(screen.getByTestId('settings-header-add')).toBeDisabled();

  await fireEvent.changeText(screen.getByTestId('settings-footer-0'), 'Changed footer');
  await fireEvent.press(screen.getByTestId('settings-save'));
  expect(await screen.findByTestId('settings-footer-0-error')).toHaveTextContent('Too long for the printer.');
});

it('says when nothing changed, without sending', async () => {
  const { calls } = await openSettings();
  await fireEvent.press(screen.getByTestId('settings-save'));
  expect(within(screen.getByTestId('form-notice')).getByText('Nothing changed.')).toBeOnTheScreen();
  expect(patchCalls(calls)).toHaveLength(0);
});

it('"Print sample" prints the lines being edited on this tablet\'s receipt printer', async () => {
  await openSettings();
  await fireEvent.changeText(screen.getByTestId('settings-header-0'), 'Kuya’s Grill');
  await fireEvent.press(screen.getByTestId('settings-sample'));

  const result = await screen.findByTestId('settings-sample-result');
  expect(within(result).getByText('Sample sent to Counter.')).toBeOnTheScreen();
  expect(fake.sentTo(9100)).toHaveLength(1);
  const lines = printedLines(fake.sentTo(9100)[0].bytes);
  expect(lines.slice(0, 5)).toEqual(["Kuya's Grill", '123 Rizal St., Makati', 'TIN 000-123-456-000', 'SALES RECEIPT', '*** SAMPLE ***']);
  expect(lines[lines.length - 1]).toBe('This is not an official receipt.');
});

it('shows a load error with Retry', async () => {
  let fail = true;
  routeFetch([
    {
      method: 'GET',
      path: SETTINGS,
      reply: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, { data: makeSettings() })),
    },
  ]);
  await renderWithQuery(<SettingsRoute />);
  expect(await screen.findByTestId('record-error')).toHaveTextContent(/Server Error\./);
  fail = false;
  await fireEvent.press(screen.getByTestId('record-error-retry'));
  expect(await screen.findByTestId('receipt-settings-screen')).toBeOnTheScreen();
});
