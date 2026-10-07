/**
 * Order detail → Reprint (docs/api-contract.md → Printing → Screens): Receipt
 * or Kitchen tickets (all stations), marked `*** REPRINT ***`, with each
 * job's progress; the reason when nothing can print.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import OrderRoute from '@/app/(app)/(pos)/orders/[ulid]';
import { resetPrintingForTests, whenPrintQueueIdle } from '@/printing/printActions';
import { createUnavailableTransport, EXPO_GO_MESSAGE, getPrintTransport } from '@/printing/transport';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { printedLines } from '@/test-utils/escpos';
import { createFakeTransport, makePrintConfig, type FakeTransport } from '@/test-utils/printing';
import { makeOrder } from '@/test-utils/sale';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

const FUTURE = '2099-09-25T01:30:00Z';
const ULID = makeOrder().ulid;
const getTransport = getPrintTransport as jest.Mock;
let fake: FakeTransport;

async function settle() {
  await act(async () => {
    await whenPrintQueueIdle();
  });
}

async function openOrder() {
  routeFetch([{ method: 'GET', path: `/api/v1/orders/${ULID}`, reply: () => mockResponse(200, { data: makeOrder() }) }]);
  await renderWithQuery(<OrderRoute />);
  await screen.findByTestId('order-reprint');
}

function jobStatuses(): string[] {
  return screen.getAllByTestId(/^reprint-job-[0-9A-Z]+-status$/).map((row) => String(row.props.accessibilityLabel));
}

beforeEach(async () => {
  await freshTestDatabase();
  resetPrintingForTests();
  usePrintingStore.getState().reset();
  usePrintingStore.getState().setConfig(makePrintConfig());
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: ULID });
  fake = createFakeTransport();
  getTransport.mockReturnValue(fake.transport);
});

afterEach(async () => {
  await settle();
});

it('Reprint → Kitchen tickets: every station, marked *** REPRINT ***, with each job\'s progress', async () => {
  await openOrder();
  await fireEvent.press(screen.getByTestId('order-reprint'));
  expect(screen.getByTestId('reprint-dialog')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('reprint-kitchen'));
  await settle();

  await waitFor(() => expect(jobStatuses()).toEqual(['Bar ticket #17 (reprint): Sent', 'Kitchen ticket #17 (reprint): Sent']));
  expect(printedLines(fake.sentTo(9101)[0].bytes).slice(0, 3)).toEqual(['KITCHEN', '*** REPRINT ***', '#17']);
  expect(printedLines(fake.sentTo(9102)[0].bytes).slice(0, 2)).toEqual(['BAR', '*** REPRINT ***']);
  expect(fake.sentTo(9100)).toHaveLength(0);
});

it('Reprint → Receipt: one receipt to this tablet\'s receipt printer; again prints again (never deduplicated)', async () => {
  await openOrder();
  for (let round = 1; round <= 2; round += 1) {
    await fireEvent.press(screen.getByTestId('order-reprint'));
    await fireEvent.press(screen.getByTestId('reprint-receipt'));
    await settle();
  }
  await waitFor(() => expect(jobStatuses()).toEqual(['Receipt #17 (reprint): Sent']));
  expect(fake.sentTo(9100)).toHaveLength(2);
  expect(printedLines(fake.sentTo(9100)[1].bytes)).toContain('*** REPRINT ***');
});

it('a failed reprint shows the reason with Retry', async () => {
  fake.fail(9100, 'write');
  await openOrder();
  await fireEvent.press(screen.getByTestId('order-reprint-icon'));
  await fireEvent.press(screen.getByTestId('reprint-receipt'));
  await settle();
  const error = await screen.findByTestId(/^reprint-job-[0-9A-Z]+-error$/);
  expect(error).toHaveTextContent('Counter may have printed part of this. Check before retrying.');
  expect(screen.getByTestId(/^reprint-job-[0-9A-Z]+-retry$/)).toBeOnTheScreen();
});

it('in Expo Go nothing is queued, and the reason is shown', async () => {
  getTransport.mockReturnValue(createUnavailableTransport(EXPO_GO_MESSAGE));
  await openOrder();
  await fireEvent.press(screen.getByTestId('order-reprint'));
  await fireEvent.press(screen.getByTestId('reprint-receipt'));
  const notice = await screen.findByTestId('reprint-notice');
  expect(within(notice).getByText(EXPO_GO_MESSAGE)).toBeOnTheScreen();
  expect(screen.queryAllByTestId(/^reprint-job-/)).toHaveLength(0);
});
