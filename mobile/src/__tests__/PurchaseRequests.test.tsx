/**
 * Purchase requests (docs/api-contract.md → Ingredients, Recipes & Purchasing
 * §F, §L): create (item picker, supplier, qty + unit with the base preview,
 * estimated price; idempotent by ULID with Retry on a network error), and the
 * decisions (per item Approve / Decline with a required reason, Approve all
 * remaining, the self-approval 403, the PO link).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import PurchaseRequestRoute from '@/app/(app)/(admin)/purchasing/requests/[ulid]/index';
import PurchaseRequestsIndexRoute from '@/app/(app)/(admin)/purchasing/requests/index';
import NewPurchaseRequestRoute from '@/app/(app)/(admin)/purchasing/requests/new';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import {
  makeIngredient,
  makePrItem,
  makePurchaseRequest,
  makeSupplier,
  PO_ULID,
  PR_ULID,
  requesterCashier,
  UNIT_CATALOG,
} from '@/test-utils/purchasing';
import { isUlid } from '@/utils/ulid';

const FUTURE = '2099-09-25T01:30:00Z';
const PRS = '/api/v1/purchase-requests';
const DECISIONS = `${PRS}/${PR_ULID}/decisions`;

const pickerRoutes: Route[] = [
  { method: 'GET', path: '/api/v1/units', reply: () => mockResponse(200, { data: UNIT_CATALOG }) },
  { method: 'GET', path: '/api/v1/admin/ingredients', reply: () => mockResponse(200, page([makeIngredient()], null, '/api/v1/admin/ingredients')) },
  { method: 'GET', path: '/api/v1/admin/suppliers', reply: () => mockResponse(200, page([makeSupplier()], null, '/api/v1/admin/suppliers')) },
];

function callsTo(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

function keyOf(call: FetchCall): string {
  return (call.init.headers as Record<string, string>)['Idempotency-Key'];
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.replace as jest.Mock).mockClear();
  (router.push as jest.Mock).mockClear();
});

describe('create', () => {
  async function fillFlour() {
    await fireEvent.press(screen.getByTestId('pr-item-0-item'));
    await fireEvent.press(await screen.findByTestId('pr-item-0-item-option-ingredient-5'));
    await fireEvent.press(screen.getByTestId('pr-item-0-supplier'));
    await fireEvent.press(await screen.findByTestId('pr-item-0-supplier-option-4'));
    await fireEvent.changeText(screen.getByTestId('pr-item-0-qty'), '2');
    await fireEvent.press(screen.getByTestId('pr-item-0-units-sack'));
    await fireEvent.changeText(screen.getByTestId('pr-item-0-price'), '1200');
  }

  it('checks every row before sending, then shows the preview and the estimate', async () => {
    const { calls } = routeFetch(pickerRoutes);
    await renderWithQuery(<NewPurchaseRequestRoute />);
    await fireEvent.press(screen.getByTestId('pr-save'));
    expect(screen.getByTestId('pr-item-0-item-error')).toHaveTextContent('Choose an item.');
    expect(screen.getByTestId('pr-item-0-supplier-error')).toHaveTextContent('Choose a supplier.');
    expect(callsTo(calls, 'POST', PRS)).toHaveLength(0);

    await fillFlour();
    expect(screen.getByTestId('pr-item-0-preview')).toHaveTextContent('= 50,000 g (50 kg)');
    expect(screen.getByTestId('pr-item-0-estimate')).toHaveTextContent('Est. ₱2,400.00 for 2 sack');
  });

  it('the picker offers active ingredients only, and never loads products', async () => {
    const { calls } = routeFetch(pickerRoutes);
    await renderWithQuery(<NewPurchaseRequestRoute />);
    await fireEvent.press(screen.getByTestId('pr-item-0-item'));
    expect(await screen.findByTestId('pr-item-0-item-option-ingredient-5')).toBeOnTheScreen();
    expect(screen.queryByTestId(/pr-item-0-item-option-product-/)).toBeNull();
    expect(calls.filter((call) => call.path === '/api/v1/products')).toHaveLength(0);
  });

  it('sends the body with its ULID as the Idempotency-Key, keeps it on a network error, and retries the same body', async () => {
    let attempt = 0;
    const { calls } = routeFetch([
      ...pickerRoutes,
      {
        method: 'POST',
        path: PRS,
        reply: () => {
          attempt += 1;
          if (attempt === 1) return Promise.reject(new TypeError('Network request failed'));
          return mockResponse(201, { data: makePurchaseRequest() });
        },
      },
    ]);
    await renderWithQuery(<NewPurchaseRequestRoute />);
    await fillFlour();
    await fireEvent.changeText(screen.getByTestId('pr-remarks'), 'For the weekend');
    await fireEvent.press(screen.getByTestId('pr-save'));

    expect(await screen.findByTestId('form-banner')).toHaveTextContent(/couldn't confirm/);
    expect(screen.getByTestId('pr-save')).toHaveTextContent(/Retry/);
    const first = callsTo(calls, 'POST', PRS)[0] as FetchCall;
    const body = jsonBody(first) as Record<string, unknown>;
    expect(isUlid(body.ulid as string)).toBe(true);
    expect(keyOf(first)).toBe(body.ulid);
    expect(body).toEqual({
      ulid: body.ulid,
      date_needed: null,
      remarks: 'For the weekend',
      items: [{ item_type: 'ingredient', item_id: 5, supplier_id: 4, qty: '2', unit: 'sack', estimated_unit_price_cents: 120000, remarks: null }],
    });

    await fireEvent.press(screen.getByTestId('pr-save'));
    await waitFor(() => expect(callsTo(calls, 'POST', PRS)).toHaveLength(2));
    const second = callsTo(calls, 'POST', PRS)[1] as FetchCall;
    expect(jsonBody(second)).toEqual(body);
    expect(keyOf(second)).toBe(body.ulid);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/purchasing/requests/[ulid]', params: { ulid: PR_ULID } }));
  });

  it('a 422 on an item field lands under that row', async () => {
    routeFetch([
      ...pickerRoutes,
      { method: 'POST', path: PRS, reply: () => mockResponse(422, { message: 'Invalid.', errors: { 'items.0.unit': ['Add "tbsp" to Flour\'s units first.'] } }) },
    ]);
    await renderWithQuery(<NewPurchaseRequestRoute />);
    await fillFlour();
    await fireEvent.press(screen.getByTestId('pr-save'));
    expect(await screen.findByTestId('pr-item-0-unit-error')).toHaveTextContent('Add "tbsp" to Flour\'s units first.');
  });
});

describe('decide', () => {
  function detailRoutes(extra: Route[] = [], pr = makePurchaseRequest()): Route[] {
    return [{ method: 'GET', path: `${PRS}/${PR_ULID}`, reply: () => mockResponse(200, { data: pr }) }, ...extra];
  }

  async function renderDetail() {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: PR_ULID });
    await renderWithQuery(<PurchaseRequestRoute />);
    await screen.findByTestId('pr-detail-screen');
  }

  it('approves one item', async () => {
    const approved = makePurchaseRequest({ items: [makePrItem({ decision: 'approved', decided_by: { id: 2, name: 'Mia Manager' }, decided_at: '2026-09-28T02:00:00Z' }), makePurchaseRequest().items[1]!] });
    const { calls } = routeFetch(detailRoutes([{ method: 'POST', path: DECISIONS, reply: () => mockResponse(200, { data: approved }) }]));
    await renderDetail();

    await fireEvent.press(screen.getByTestId('pr-detail-item-31-approve'));
    await waitFor(() => expect(callsTo(calls, 'POST', DECISIONS)).toHaveLength(1));
    expect(jsonBody(callsTo(calls, 'POST', DECISIONS)[0] as FetchCall)).toEqual({ decisions: [{ item_id: 31, decision: 'approved' }] });
    expect(await screen.findByTestId('pr-detail-notice')).toHaveTextContent(/Approved “Flour”/);
    expect(screen.getByTestId('pr-detail-item-31-decision')).toHaveTextContent(/Approved/);
    expect(screen.queryByTestId('pr-detail-item-31-approve')).toBeNull();
    // Q-027: an ingredient quantity is a 3-decimal string, a product's an integer; both read the same.
    expect(screen.getByTestId('pr-detail-item-31-qty')).toHaveTextContent('2 sack');
    expect(screen.getByTestId('pr-detail-item-32-qty')).toHaveTextContent('24 pc');
    // The summary card: estimates only where every counted item has a price (no partial sums).
    expect(screen.getByTestId('pr-detail-totals-approved')).toHaveTextContent('1 item · ₱2,400.00');
    expect(screen.getByTestId('pr-detail-totals-pending')).toHaveTextContent('1 item');
    expect(screen.getByTestId('pr-detail-totals-estimate')).toHaveTextContent('Not every item has a price');
  });

  it('a decline needs a reason; the last decision creates the PO and links it', async () => {
    const decided = makePurchaseRequest({
      status: 'partially_approved',
      items: [
        makePrItem({ decision: 'approved' }),
        makePrItem({ id: 32, item: { type: 'product', id: 9, name: 'Iced Tea' }, qty: '24.000', unit: 'pc', decision: 'declined', decision_reason: 'Enough stock' }),
      ],
      purchase_order: { ulid: PO_ULID, po_no: 'PO-MAIN-2026-00001', status: 'pending_approval' },
    });
    const { calls } = routeFetch(detailRoutes([{ method: 'POST', path: DECISIONS, reply: () => mockResponse(200, { data: decided }) }]));
    await renderDetail();

    await fireEvent.press(screen.getByTestId('pr-detail-item-32-decline'));
    await fireEvent.press(screen.getByTestId('pr-decline-dialog-confirm'));
    expect(screen.getByTestId('pr-decline-reason-error')).toHaveTextContent('Give a reason for declining.');
    expect(callsTo(calls, 'POST', DECISIONS)).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('pr-decline-reason'), 'Enough stock');
    await fireEvent.press(screen.getByTestId('pr-decline-dialog-confirm'));
    await waitFor(() => expect(callsTo(calls, 'POST', DECISIONS)).toHaveLength(1));
    expect(jsonBody(callsTo(calls, 'POST', DECISIONS)[0] as FetchCall)).toEqual({ decisions: [{ item_id: 32, decision: 'declined', reason: 'Enough stock' }] });

    expect(await screen.findByTestId('pr-detail-notice')).toHaveTextContent(/PO-MAIN-2026-00001 was created/);
    expect(screen.getByTestId('pr-detail-item-32-reason')).toHaveTextContent('Reason: Enough stock');
    await fireEvent.press(screen.getByTestId('pr-detail-open-po'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/purchasing/orders/[ulid]', params: { ulid: PO_ULID } });
  });

  it('the server reason 422 shows under the reason field', async () => {
    routeFetch(detailRoutes([{ method: 'POST', path: DECISIONS, reply: () => mockResponse(422, { message: 'Invalid.', errors: { 'decisions.0.reason': ['Give a reason for declining.'] } }) }]));
    await renderDetail();
    await fireEvent.press(screen.getByTestId('pr-detail-item-32-decline'));
    await fireEvent.changeText(screen.getByTestId('pr-decline-reason'), '  x ');
    await fireEvent.press(screen.getByTestId('pr-decline-dialog-confirm'));
    expect(await screen.findByTestId('pr-decline-reason-error')).toHaveTextContent('Give a reason for declining.');
  });

  it('Approve all remaining sends every pending item', async () => {
    const { calls } = routeFetch(detailRoutes([{ method: 'POST', path: DECISIONS, reply: () => mockResponse(200, { data: makePurchaseRequest({ status: 'approved' }) }) }]));
    await renderDetail();
    await fireEvent.press(screen.getByTestId('pr-detail-approve-all'));
    await fireEvent.press(screen.getByTestId('pr-approve-all-dialog-confirm'));
    await waitFor(() => expect(callsTo(calls, 'POST', DECISIONS)).toHaveLength(1));
    expect(jsonBody(callsTo(calls, 'POST', DECISIONS)[0] as FetchCall)).toEqual({
      decisions: [
        { item_id: 31, decision: 'approved' },
        { item_id: 32, decision: 'approved' },
      ],
    });
  });

  it('deciding your own request without purchase.approve_own shows the 403 message', async () => {
    const own = makePurchaseRequest({ requested_by: { id: managerUser.id, name: managerUser.name } });
    routeFetch(detailRoutes([{ method: 'POST', path: DECISIONS, reply: () => mockResponse(403, { message: 'Someone else must approve your own request.' }) }], own));
    await renderDetail();

    expect(screen.getByTestId('pr-detail-own')).toHaveTextContent(/Someone else must approve your own request/);
    await fireEvent.press(screen.getByTestId('pr-detail-item-31-approve'));
    expect(await screen.findByTestId('pr-detail-banner')).toHaveTextContent(/Someone else must approve your own request\./);
    expect(screen.getByTestId('pr-detail-item-31-decision')).toHaveTextContent(/Pending/);
  });

  it('a requester without purchase.approve sees no decision buttons, but may edit their undecided request', async () => {
    useSessionStore.getState().setSignedIn(requesterCashier, FUTURE);
    routeFetch(detailRoutes());
    await renderDetail();
    expect(screen.queryByTestId('pr-detail-item-31-approve')).toBeNull();
    expect(screen.queryByTestId('pr-detail-approve-all')).toBeNull();
    await fireEvent.press(screen.getByTestId('pr-detail-edit'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/purchasing/requests/[ulid]/edit', params: { ulid: PR_ULID } });
  });
});

describe('list', () => {
  it('Needs my decision sends needs_decision=1; Mine sends mine=1; status chips filter', async () => {
    const { calls } = routeFetch([{ method: 'GET', path: PRS, reply: () => mockResponse(200, page([makePurchaseRequest()], null, PRS)) }]);
    await renderWithQuery(<PurchaseRequestsIndexRoute />);
    const card = await screen.findByTestId(`pr-card-${PR_ULID}`);
    expect(within(card).getByTestId(`pr-card-${PR_ULID}-status`)).toHaveTextContent(/Pending Approval/);

    await fireEvent.press(screen.getByTestId('pr-view-decision'));
    await waitFor(() => expect(calls.at(-1)?.query.get('needs_decision')).toBe('1'));
    await fireEvent.press(screen.getByTestId('pr-view-mine'));
    await waitFor(() => expect(calls.at(-1)?.query.get('mine')).toBe('1'));
    await fireEvent.press(screen.getByTestId('pr-status-declined'));
    await waitFor(() => expect(calls.at(-1)?.query.get('status')).toBe('declined'));
  });

  it('a requester without purchase.approve has no Needs my decision view', async () => {
    useSessionStore.getState().setSignedIn(requesterCashier, FUTURE);
    routeFetch([{ method: 'GET', path: PRS, reply: () => mockResponse(200, page([], null, PRS)) }]);
    await renderWithQuery(<PurchaseRequestsIndexRoute />);
    await screen.findByTestId('prs-grid-empty');
    expect(screen.queryByTestId('pr-view-decision')).toBeNull();
    expect(screen.getByTestId('prs-new')).toBeOnTheScreen();
  });
});
