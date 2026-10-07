/**
 * Checkout → printing (docs/api-contract.md → Printing → Screens → Sale
 * complete): the success screen appears at once and never waits for a
 * printer; one status row per job ("Sending…", "Sent", or failed with
 * Retry); the Q-004 lookup prints too, but only once; Expo Go says it can't print.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import CheckoutRoute from '@/app/(app)/(pos)/sell/checkout';
import { printRepository } from '@/db/printRepository';
import { resetPrintingForTests, whenPrintQueueIdle } from '@/printing/printActions';
import { createUnavailableTransport, getPrintTransport } from '@/printing/transport';
import { resetCart, useCartStore } from '@/stores/cart';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';
import { seedOpenShift } from '@/test-utils/shifts';
import { createFakeTransport, makePrintConfig, makeSettings, type FakeTransport } from '@/test-utils/printing';
import { fillCartWithExampleB, makeOrder } from '@/test-utils/sale';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/printing/transport', () => {
  const actual = jest.requireActual<typeof import('@/printing/transport')>('@/printing/transport');
  return { ...actual, getPrintTransport: jest.fn(actual.getPrintTransport) };
});

const FUTURE = '2099-09-25T01:30:00Z';
const ORDERS = '/api/v1/orders';
const getTransport = getPrintTransport as jest.Mock;
let fake: FakeTransport;

/** Lets the print queue finish inside act(). */
async function settlePrinting() {
  await act(async () => {
    await whenPrintQueueIdle();
  });
}

function statusRows(): string[] {
  return screen.getAllByTestId(/^sale-print-job-[0-9A-Z]+-status$/).map((row) => String(row.props.accessibilityLabel));
}

async function checkOut() {
  fillCartWithExampleB();
  useCartStore.getState().beginCheckout();
  await renderWithQuery(<CheckoutRoute />);
  await fireEvent.press(await screen.findByTestId('checkout-cash-exact'));
  await fireEvent.press(screen.getByTestId('checkout-confirm'));
  expect(await screen.findByTestId('sale-complete')).toBeOnTheScreen();
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
  resetCart();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  fake = createFakeTransport();
  getTransport.mockReturnValue(fake.transport);
});

afterEach(async () => {
  // Let the queue finish inside act(), so no store update lands after the test.
  await settlePrinting();
});

it('shows the success screen at once while printers are still being sent to, then "Sent"', async () => {
  fake.hold(9100);
  fake.hold(9101);
  fake.hold(9102);
  routeFetch([{ method: 'POST', path: ORDERS, reply: () => mockResponse(201, { data: makeOrder() }) }]);
  await checkOut();

  expect(screen.getByTestId('sale-change')).toHaveTextContent('₱43.00');
  await waitFor(() => expect(statusRows()).toHaveLength(3));
  expect(statusRows()).toEqual(['Receipt #17: Sending', 'Bar ticket #17: Sending', 'Kitchen ticket #17: Sending']);

  await act(async () => {
    fake.release(9100);
    fake.release(9101);
    fake.release(9102);
  });
  await settlePrinting();
  await waitFor(() => expect(statusRows()).toEqual(['Receipt #17: Sent', 'Bar ticket #17: Sent', 'Kitchen ticket #17: Sent']));
  // "Sent", never "Printed": port 9100 gives no confirmation.
  expect(screen.queryByText(/Printed/)).toBeNull();
});

it('a failed print shows why, with Retry; the sale itself is untouched', async () => {
  fake.fail(9101, 'write', 1);
  routeFetch([{ method: 'POST', path: ORDERS, reply: () => mockResponse(201, { data: makeOrder() }) }]);
  await checkOut();
  await settlePrinting();

  const [, , kitchenId] = usePrintingStore.getState().sales[makeOrder().ulid].jobIds;
  const error = await screen.findByTestId(`sale-print-job-${kitchenId}-error`);
  expect(error).toHaveTextContent('Kitchen may have printed part of this. Check before retrying.');
  expect(useCartStore.getState().lines).toEqual([]);

  await fireEvent.press(screen.getByTestId(`sale-print-job-${kitchenId}-retry`));
  await settlePrinting();
  await waitFor(() => expect(screen.getByTestId(`sale-print-job-${kitchenId}-status`).props.accessibilityLabel).toBe('Kitchen ticket #17: Sent'));
  expect(fake.sentTo(9101)).toHaveLength(1);
});

it('the Q-004 lookup prints the sale too, once, even when it was already printed', async () => {
  // An earlier attempt printed this sale.
  const { printSale } = jest.requireActual<typeof import('@/printing/printActions')>('@/printing/printActions');
  await printSale(makeOrder());
  await settlePrinting();
  expect(fake.sent).toHaveLength(3);

  routeFetch([
    {
      method: 'POST',
      path: ORDERS,
      reply: () => mockResponse(409, { message: 'This Idempotency-Key was already used for a different request.' }),
    },
    { method: 'GET', path: `${ORDERS}/${makeOrder().ulid}`, reply: () => mockResponse(200, { data: makeOrder() }) },
  ]);
  fillCartWithExampleB();
  useCartStore.setState({ pendingUlid: makeOrder().ulid });
  await renderWithQuery(<CheckoutRoute />);
  await fireEvent.press(await screen.findByTestId('checkout-cash-exact'));
  await fireEvent.press(screen.getByTestId('checkout-confirm'));

  expect(await screen.findByTestId('sale-note')).toBeOnTheScreen();
  await waitFor(() => expect(statusRows()).toHaveLength(3));
  await settlePrinting();
  expect(fake.sent).toHaveLength(3);
  expect(await printRepository.jobsForOrder(makeOrder().ulid)).toHaveLength(3);
});

it('auto-print off: "Print receipt" prints the receipt; without a receipt printer it says so', async () => {
  usePrintingStore.getState().setConfig(makePrintConfig({ settings: makeSettings({ auto_print_receipt: false }) }));
  routeFetch([{ method: 'POST', path: ORDERS, reply: () => mockResponse(201, { data: makeOrder() }) }]);
  await checkOut();

  await fireEvent.press(await screen.findByTestId('sale-print-receipt'));
  await settlePrinting();
  await waitFor(() => expect(statusRows()).toContain('Receipt #17: Sent'));
  expect(screen.queryByTestId('sale-print-receipt')).toBeNull();
  expect(fake.sentTo(9100)).toHaveLength(1);
});

it('says when this tablet has no receipt printer, and lists items no printer takes', async () => {
  const config = makePrintConfig();
  usePrintingStore.getState().setConfig({ ...config, printers: config.printers.filter((printer) => printer.name === 'Bar') });
  routeFetch([{ method: 'POST', path: ORDERS, reply: () => mockResponse(201, { data: makeOrder() }) }]);
  await checkOut();

  const notice = await screen.findByTestId('sale-no-receipt-printer');
  expect(within(notice).getByText('No receipt printer is set up for this tablet.')).toBeOnTheScreen();
  const unrouted = screen.getByTestId('sale-unrouted');
  expect(within(unrouted).getByText(/1 x Hot Dog/)).toBeOnTheScreen();
  expect(within(unrouted).getByText(/2 x Rice Cake/)).toBeOnTheScreen();
});

it("Expo Go: the sale completes and the screen says printing needs the POS dev build", async () => {
  getTransport.mockReturnValue(createUnavailableTransport("Printing needs the POS dev build. Expo Go can't connect to printers."));
  routeFetch([{ method: 'POST', path: ORDERS, reply: () => mockResponse(201, { data: makeOrder() }) }]);
  await checkOut();

  const notice = await screen.findByTestId('sale-printing-notice');
  expect(within(notice).getByText("Printing needs the POS dev build. Expo Go can't connect to printers.")).toBeOnTheScreen();
  expect(screen.queryAllByTestId(/^sale-print-job-/)).toHaveLength(0);
});
