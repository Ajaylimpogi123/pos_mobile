/**
 * Receiving (docs/api-contract.md → Ingredients, Recipes & Purchasing §H, §L):
 * the list of POs to receive, the receive screen's live status chips
 * (Over-received as a warning), entry in another unit, a correction with its
 * required reason, and the receipt ULID kept until the 201 (Retry resends the
 * same body and key).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import ReceiveRoute from '@/app/(app)/(admin)/purchasing/receiving/[ulid]';
import ReceivingIndexRoute from '@/app/(app)/(admin)/purchasing/receiving/index';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { makeIngredient, makePoLine, makePurchaseOrder, PO_ULID, UNIT_CATALOG } from '@/test-utils/purchasing';
import { isUlid } from '@/utils/ulid';
import { useToastStore } from '@/stores/toast';

const FUTURE = '2099-09-25T01:30:00Z';
const PO = `/api/v1/purchase-orders/${PO_ULID}`;
const RECEIPTS = `${PO}/receipts`;

const approved = makePurchaseOrder({ status: 'approved' });

function routes(extra: Route[] = [], po = approved): Route[] {
  return [
    { method: 'GET', path: PO, reply: () => mockResponse(200, { data: po }) },
    { method: 'GET', path: '/api/v1/units', reply: () => mockResponse(200, { data: UNIT_CATALOG }) },
    { method: 'GET', path: '/api/v1/admin/ingredients/5', reply: () => mockResponse(200, { data: makeIngredient() }) },
    ...extra,
  ];
}

function receipts(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method === 'POST' && call.path === RECEIPTS);
}

async function renderReceive() {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: PO_ULID });
  await renderWithQuery(<ReceiveRoute />);
  await screen.findByTestId('receive-screen');
  await screen.findByTestId('receive-line-41-qty');
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.push as jest.Mock).mockClear();
});

it('the list shows approved POs to receive (to_receive=1) and opens the receive screen', async () => {
  const { calls } = routeFetch([{ method: 'GET', path: '/api/v1/purchase-orders', reply: () => mockResponse(200, page([approved], null, '/api/v1/purchase-orders')) }]);
  await renderWithQuery(<ReceivingIndexRoute />);
  await fireEvent.press(await screen.findByTestId(`po-card-${PO_ULID}-open`));
  expect(calls[0]?.query.get('to_receive')).toBe('1');
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/purchasing/receiving/[ulid]', params: { ulid: PO_ULID } });
});

it('shows ordered / received / remaining and a live status chip as quantities are typed', async () => {
  routeFetch(routes());
  await renderReceive();
  expect(screen.getByTestId('receive-line-41-ordered')).toHaveTextContent('Ordered 2 sack');
  expect(screen.getByTestId('receive-line-41-remaining')).toHaveTextContent('Remaining 2 sack');
  expect(screen.getByTestId('receive-line-41-status')).toHaveTextContent(/Pending/);

  await fireEvent.changeText(screen.getByTestId('receive-line-41-qty'), '1');
  expect(screen.getByTestId('receive-line-41-status')).toHaveTextContent(/Partial after this/);
  expect(screen.getByTestId('receive-line-41-preview')).toHaveTextContent('= 25,000 g (25 kg)');

  await fireEvent.changeText(screen.getByTestId('receive-line-41-qty'), '2.2');
  expect(screen.getByTestId('receive-line-41-status')).toHaveTextContent(/Over-received after this/);
  expect(screen.getByTestId('receive-line-41-over')).toBeOnTheScreen();

  // Another unit: 50 kg is exactly the 2 sacks ordered.
  await fireEvent.press(screen.getByTestId('receive-line-41-units-kg'));
  await fireEvent.changeText(screen.getByTestId('receive-line-41-qty'), '50');
  expect(screen.getByTestId('receive-line-41-status')).toHaveTextContent(/Complete after this/);
});

it('keeps the ULID after a network error, retries the same body, then shows the 201 PO and its receipt', async () => {
  let attempt = 0;
  const after = makePurchaseOrder({
    status: 'approved',
    receiving_status: 'partially_received',
    lines: [makePoLine({ received_base_qty: '25000.000', received_qty: '1.000', remaining_qty: '1.000', receiving_status: 'partial' })],
    receipts: [
      {
        ulid: '01K6GR0000000000000000000A',
        received_by: { id: 2, name: 'Mia Manager' },
        received_at: '2026-09-28T05:00:00Z',
        remarks: 'DR 1234',
        lines: [{ po_line_id: 41, qty: '1.000', unit: 'sack', base_qty: '25000.000', cost_cents: 120000, reason: null }],
      },
    ],
  });
  const { calls } = routeFetch(
    routes([
      {
        method: 'POST',
        path: RECEIPTS,
        reply: () => {
          attempt += 1;
          return attempt === 1 ? Promise.reject(new TypeError('Network request failed')) : mockResponse(201, { data: after });
        },
      },
    ]),
  );
  await renderReceive();
  await fireEvent.changeText(screen.getByTestId('receive-line-41-qty'), '1');
  await fireEvent.changeText(screen.getByTestId('receive-remarks'), 'DR 1234');
  await fireEvent.press(screen.getByTestId('receive-save'));

  expect(await screen.findByTestId('form-banner')).toHaveTextContent(/couldn't confirm the receipt/);
  expect(screen.getByTestId('receive-save')).toHaveTextContent(/Retry/);
  const first = receipts(calls)[0] as FetchCall;
  const body = jsonBody(first) as { ulid: string };
  expect(isUlid(body.ulid)).toBe(true);
  expect((first.init.headers as Record<string, string>)['Idempotency-Key']).toBe(body.ulid);
  expect(body).toEqual({ ulid: body.ulid, remarks: 'DR 1234', lines: [{ po_line_id: 41, qty: '1', unit: 'sack' }] });

  await fireEvent.press(screen.getByTestId('receive-save'));
  await waitFor(() => expect(receipts(calls)).toHaveLength(2));
  expect(jsonBody(receipts(calls)[1] as FetchCall)).toEqual(body);

  await waitFor(() => expect(useToastStore.getState().toast?.message).toMatch(/^Receipt saved/));
  expect(screen.getByTestId('receive-line-41-received')).toHaveTextContent('Received 1 sack');
  expect(screen.getByTestId('po-receipt-01K6GR0000000000000000000A-line-0')).toHaveTextContent(/Flour: \+1 sack · ₱1,200.00/);
  expect(screen.getByTestId('receive-line-41-qty').props.value).toBe('');
});

it('a correction is negative and needs a reason; it cannot go below what was received', async () => {
  const received = makePurchaseOrder({
    status: 'approved',
    receiving_status: 'fully_received',
    lines: [makePoLine({ received_base_qty: '55000.000', received_qty: '2.200', remaining_qty: '0.000', receiving_status: 'over_received' })],
  });
  const { calls } = routeFetch(routes([{ method: 'POST', path: RECEIPTS, reply: () => mockResponse(201, { data: received }) }], received));
  await renderReceive();
  expect(screen.getByTestId('receive-line-41-status')).toHaveTextContent(/Over-received/);

  await fireEvent(screen.getByTestId('receive-line-41-correction'), 'valueChange', true);
  await fireEvent.changeText(screen.getByTestId('receive-line-41-qty'), '3');
  expect(screen.getByTestId('receive-line-41-qty-error')).toHaveTextContent('Only 2.2 sack was received.');

  await fireEvent.changeText(screen.getByTestId('receive-line-41-qty'), '0.2');
  expect(screen.getByTestId('receive-line-41-status')).toHaveTextContent(/Complete after this/);
  await fireEvent.press(screen.getByTestId('receive-save'));
  expect(screen.getByTestId('receive-line-41-reason-error')).toHaveTextContent('Give a reason for the correction.');
  expect(receipts(calls)).toHaveLength(0);

  await fireEvent.changeText(screen.getByTestId('receive-line-41-reason'), 'Counted wrong');
  await fireEvent.press(screen.getByTestId('receive-save'));
  await waitFor(() => expect(receipts(calls)).toHaveLength(1));
  expect((jsonBody(receipts(calls)[0] as FetchCall) as { lines: unknown }).lines).toEqual([
    { po_line_id: 41, qty: '-0.2', unit: 'sack', reason: 'Counted wrong' },
  ]);
});

it('a 422 on a sent line lands under that PO line', async () => {
  routeFetch(routes([{ method: 'POST', path: RECEIPTS, reply: () => mockResponse(422, { message: 'Invalid.', errors: { 'lines.0.qty': ['Only 0 sack was received.'] } }) }]));
  await renderReceive();
  await fireEvent.changeText(screen.getByTestId('receive-line-41-qty'), '1');
  await fireEvent.press(screen.getByTestId('receive-save'));
  expect(await screen.findByTestId('receive-line-41-qty-error')).toHaveTextContent('Only 0 sack was received.');
});

it('a product line: integer quantities from the server (Q-027), pc only, whole numbers', async () => {
  const productLine = makePoLine({
    id: 42,
    item: { type: 'product', id: 9, name: 'Iced Tea' },
    qty: 24,
    unit: 'pc',
    base_qty: 24,
    unit_price_cents: 1200,
    line_total_cents: 28800,
    received_base_qty: 10,
    received_qty: 10,
    remaining_qty: 14,
    receiving_status: 'partial',
  });
  const po = makePurchaseOrder({ status: 'approved', receiving_status: 'partially_received', lines: [productLine] });
  const { calls } = routeFetch(routes([{ method: 'POST', path: RECEIPTS, reply: () => mockResponse(201, { data: po }) }], po));
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: PO_ULID });
  await renderWithQuery(<ReceiveRoute />);
  await screen.findByTestId('receive-line-42-qty');

  expect(screen.getByTestId('receive-line-42-ordered')).toHaveTextContent('Ordered 24 pc');
  expect(screen.getByTestId('receive-line-42-received')).toHaveTextContent('Received 10 pc');
  expect(screen.getByTestId('receive-line-42-units-single')).toHaveTextContent('Unit: pc');

  await fireEvent.changeText(screen.getByTestId('receive-line-42-qty'), '14');
  expect(screen.getByTestId('receive-line-42-status')).toHaveTextContent(/Complete after this/);

  await fireEvent.changeText(screen.getByTestId('receive-line-42-qty'), '1.5');
  await fireEvent.press(screen.getByTestId('receive-save'));
  expect(screen.getByTestId('receive-line-42-qty-error')).toHaveTextContent('A product quantity must be a whole number.');
  expect(receipts(calls)).toHaveLength(0);

  await fireEvent.changeText(screen.getByTestId('receive-line-42-qty'), '14');
  await fireEvent.press(screen.getByTestId('receive-save'));
  await waitFor(() => expect(receipts(calls)).toHaveLength(1));
  expect((jsonBody(receipts(calls)[0] as FetchCall) as { lines: unknown }).lines).toEqual([{ po_line_id: 42, qty: '14', unit: 'pc' }]);
});

it('asks for at least one quantity', async () => {
  const { calls } = routeFetch(routes());
  await renderReceive();
  await fireEvent.press(screen.getByTestId('receive-save'));
  expect(screen.getByTestId('receive-form-error')).toHaveTextContent(/Enter a quantity for at least one line/);
  expect(receipts(calls)).toHaveLength(0);
});
