/**
 * Purchase orders (docs/api-contract.md → Ingredients, Recipes & Purchasing
 * §G, §L): the detail, **Approve** (the ₱0 422 and the self-approval 403
 * shown), **Decline** with a required reason, line edits while pending, and
 * the list filters (the dashboard's Pending Approval view).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import PurchaseOrderRoute from '@/app/(app)/(admin)/purchasing/orders/[ulid]';
import PurchaseOrdersIndexRoute from '@/app/(app)/(admin)/purchasing/orders/index';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { makeIngredient, makePoLine, makePurchaseOrder, PO_ULID, UNIT_CATALOG } from '@/test-utils/purchasing';

const FUTURE = '2099-09-25T01:30:00Z';
const PO = `/api/v1/purchase-orders/${PO_ULID}`;

function callsTo(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

function routes(extra: Route[] = [], po = makePurchaseOrder()): Route[] {
  return [
    { method: 'GET', path: PO, reply: () => mockResponse(200, { data: po }) },
    { method: 'GET', path: '/api/v1/units', reply: () => mockResponse(200, { data: UNIT_CATALOG }) },
    { method: 'GET', path: '/api/v1/admin/ingredients/5', reply: () => mockResponse(200, { data: makeIngredient() }) },
    ...extra,
  ];
}

async function renderDetail() {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: PO_ULID });
  await renderWithQuery(<PurchaseOrderRoute />);
  await screen.findByTestId('po-detail-screen');
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.push as jest.Mock).mockClear();
});

describe('detail', () => {
  it('shows the status, the lines with prices and totals, and the timeline', async () => {
    routeFetch(routes());
    await renderDetail();
    expect(screen.getByTestId('po-detail-status')).toHaveTextContent(/Pending Approval/);
    expect(screen.getByTestId('po-line-41-qty')).toHaveTextContent('2 sack @ ₱1,200.00');
    expect(screen.getByTestId('po-line-41-total')).toHaveTextContent('₱2,400.00');
    expect(screen.getByTestId('po-detail-total')).toHaveTextContent('₱2,400.00');
    expect(screen.getByTestId('po-detail-timeline-0')).toHaveTextContent(/Purchase order created/);
  });

  it('approves; the answer shows Approved · Ready for Receiving and Receive', async () => {
    const approved = makePurchaseOrder({ status: 'approved', approved_by: { id: 2, name: 'Mia Manager' }, approved_at: '2026-09-28T03:00:00Z' });
    const { calls } = routeFetch(routes([{ method: 'POST', path: `${PO}/approve`, reply: () => mockResponse(200, { data: approved }) }]));
    await renderDetail();
    await fireEvent.press(screen.getByTestId('po-detail-approve'));
    await fireEvent.press(screen.getByTestId('po-approve-dialog-confirm'));

    await waitFor(() => expect(callsTo(calls, 'POST', `${PO}/approve`)).toHaveLength(1));
    expect(await screen.findByTestId('po-detail-notice')).toHaveTextContent(/approved and ready for receiving/);
    expect(screen.getByTestId('po-detail-status')).toHaveTextContent(/Approved · Ready for Receiving/);
    await fireEvent.press(screen.getByTestId('po-detail-receive'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/purchasing/receiving/[ulid]', params: { ulid: PO_ULID } });
  });

  it('shows the ₱0 422 when a line has no price', async () => {
    const unpriced = makePurchaseOrder({ lines: [makePoLine({ unit_price_cents: 0, line_total_cents: 0 })], total_cents: 0 });
    routeFetch(
      routes([{ method: 'POST', path: `${PO}/approve`, reply: () => mockResponse(422, { message: 'Set a price for every line before approving.', errors: {} }) }], unpriced),
    );
    await renderDetail();
    expect(screen.getByTestId('po-line-41-no-price')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('po-detail-approve'));
    await fireEvent.press(screen.getByTestId('po-approve-dialog-confirm'));
    expect(await screen.findByTestId('po-detail-banner')).toHaveTextContent(/Set a price for every line before approving\./);
    expect(screen.getByTestId('po-detail-status')).toHaveTextContent(/Pending Approval/);
  });

  it('shows the self-approval 403', async () => {
    routeFetch(routes([{ method: 'POST', path: `${PO}/approve`, reply: () => mockResponse(403, { message: 'Someone else must approve your own request.' }) }]));
    await renderDetail();
    await fireEvent.press(screen.getByTestId('po-detail-approve'));
    await fireEvent.press(screen.getByTestId('po-approve-dialog-confirm'));
    expect(await screen.findByTestId('po-detail-banner')).toHaveTextContent(/Someone else must approve your own request\./);
  });

  it('declines only with a reason', async () => {
    const declined = makePurchaseOrder({ status: 'declined', decline_reason: 'Supplier closed' });
    const { calls } = routeFetch(routes([{ method: 'POST', path: `${PO}/decline`, reply: () => mockResponse(200, { data: declined }) }]));
    await renderDetail();
    await fireEvent.press(screen.getByTestId('po-detail-decline'));
    await fireEvent.press(screen.getByTestId('po-decline-dialog-confirm'));
    expect(screen.getByTestId('po-decline-reason-error')).toHaveTextContent('Give a reason for declining.');
    expect(callsTo(calls, 'POST', `${PO}/decline`)).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('po-decline-reason'), 'Supplier closed');
    await fireEvent.press(screen.getByTestId('po-decline-dialog-confirm'));
    await waitFor(() => expect(callsTo(calls, 'POST', `${PO}/decline`)).toHaveLength(1));
    expect(jsonBody(callsTo(calls, 'POST', `${PO}/decline`)[0] as FetchCall)).toEqual({ reason: 'Supplier closed' });
    expect(await screen.findByTestId('po-detail-decline-reason')).toHaveTextContent('Supplier closed');
    expect(screen.queryByTestId('po-detail-approve')).toBeNull();
  });

  it('edits a pending line: only the changed fields are sent, by id', async () => {
    const updated = makePurchaseOrder({ lines: [makePoLine({ qty: '3.000', line_total_cents: 360000 })], total_cents: 360000 });
    const { calls } = routeFetch(routes([{ method: 'PATCH', path: PO, reply: () => mockResponse(200, { data: updated }) }]));
    await renderDetail();
    await fireEvent.press(screen.getByTestId('po-line-41-edit'));
    await fireEvent.changeText(await screen.findByTestId('po-line-dialog-qty'), '3');
    expect(screen.getByTestId('po-line-dialog-preview')).toHaveTextContent('= 75,000 g (75 kg)');
    await fireEvent.press(screen.getByTestId('po-line-dialog-confirm'));

    await waitFor(() => expect(callsTo(calls, 'PATCH', PO)).toHaveLength(1));
    expect(jsonBody(callsTo(calls, 'PATCH', PO)[0] as FetchCall)).toEqual({ lines: [{ id: 41, qty: '3' }] });
    expect(await screen.findByTestId('po-detail-total')).toHaveTextContent('₱3,600.00');
  });

  it('a user with only report.view reads the order but gets no actions', async () => {
    useSessionStore.getState().setSignedIn({ ...cashierUser, permissions: ['report.view'] }, FUTURE);
    routeFetch(routes());
    await renderDetail();
    expect(screen.queryByTestId('po-detail-actions')).toBeNull();
    expect(screen.queryByTestId('po-line-41-edit')).toBeNull();
  });
});

describe('list', () => {
  it('opens with the dashboard filter and sends the status and receiving filters', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ status: 'pending_approval' });
    const { calls } = routeFetch([{ method: 'GET', path: '/api/v1/purchase-orders', reply: () => mockResponse(200, page([makePurchaseOrder()], null, '/api/v1/purchase-orders')) }]);
    await renderWithQuery(<PurchaseOrdersIndexRoute />);
    expect(await screen.findByTestId(`po-card-${PO_ULID}-total`)).toHaveTextContent('₱2,400.00');
    expect(calls[0]?.query.get('status')).toBe('pending_approval');
    await fireEvent.press(screen.getByTestId('po-receiving-partially_received'));
    await waitFor(() => expect(calls.at(-1)?.query.get('receiving_status')).toBe('partially_received'));
  });
});
