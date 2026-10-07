/**
 * Inventory product detail (docs/api-contract.md → Inventory (v1 completion)
 * → Device rules → Product detail): the summary card, the movement history
 * (paging, the running `qty_after`, order references, the type filter), the
 * Stock in / Count / Wastage dialogs (typed stock adjustments: request
 * bodies, ULID reuse on retry, 422s under their fields), the reorder level
 * (set, remove), refresh after writes with a stock sync, and permission gating.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import InventoryItemRoute from '@/app/(app)/(admin)/inventory/[productId]';
import { inventoryKeys } from '@/hooks/inventory/queryKeys';
import { useSessionStore } from '@/stores/session';
import { requestStockSync } from '@/sync/stockSync';
import { mockResponse, secureStoreMock } from '@/test-utils';
import {
  createTestQueryClient,
  deferred,
  jsonBody,
  managerUser,
  page,
  renderWithQuery,
  routeFetch,
  type FetchCall,
  type Route,
} from '@/test-utils/catalog';
import { inventoryPage, makeInventoryItem, makeInventoryMovement } from '@/test-utils/inventory';
import { makeStockMovement } from '@/test-utils/sale';
import { isUlid } from '@/utils/ulid';

jest.mock('@/sync/stockSync', () => ({
  requestStockSync: jest.fn(async () => ({ outcome: 'skipped' })),
}));

const FUTURE = '2099-09-25T01:30:00Z';
const ITEM = '/api/v1/inventory/9';
const MOVEMENTS = '/api/v1/inventory/9/movements';
const ADJUST = '/api/v1/admin/products/9/stock-adjustments';
const REORDER = '/api/v1/inventory/9/reorder-level';

const icedTea = makeInventoryItem();
const receipt = makeInventoryMovement();
const sale = makeInventoryMovement({
  ulid: '01K6SALE000000000000000001',
  type: 'sale',
  qty_delta: -2,
  qty_after: 9,
  // Q-021: sales carry a cost snapshot too; only a stock in shows it.
  unit_cost_cents: 1200,
  reason: null,
  occurred_at: '2026-09-27T05:10:00Z',
  created_by: { id: 3, name: 'Carla Cashier' },
  reference: { kind: 'order', ulid: '01K62Z3K5Q9V7X2M4N6P8R0T1W', label: 'INV-MAIN-00000042' },
});
const opening = makeInventoryMovement({
  ulid: '01K6OPEN000000000000000001',
  type: 'opening',
  qty_delta: 9,
  qty_after: 9,
  unit_cost_cents: null,
  reason: 'Opening stock',
  occurred_at: '2026-09-20T00:00:00Z',
  created_by: null,
});

/** GET /inventory/{product} (Q-020) and the history, with overridable replies. */
function baseRoutes(options: { item?: () => typeof icedTea; itemReply?: Route['reply']; movements?: Route['reply'] } = {}): Route[] {
  return [
    { method: 'GET', path: ITEM, reply: options.itemReply ?? (() => mockResponse(200, { data: (options.item ?? (() => icedTea))() })) },
    {
      method: 'GET',
      path: MOVEMENTS,
      reply: options.movements ?? ((call) => mockResponse(200, page(call.query.get('cursor') === 'CUR2' ? [opening] : [sale, receipt], call.query.get('cursor') ? null : 'CUR2', MOVEMENTS))),
    },
  ];
}

function callsTo(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

function keyOf(call: FetchCall): string {
  return (call.init.headers as Record<string, string>)['Idempotency-Key'];
}

async function renderDetail() {
  const result = await renderWithQuery(<InventoryItemRoute />);
  await screen.findByTestId('inventory-summary');
  await waitFor(() => expect(screen.queryByTestId('inventory-history-loading')).toBeNull());
  return result;
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (useLocalSearchParams as jest.Mock).mockReturnValue({ productId: '9' });
  (router.push as jest.Mock).mockClear();
  (requestStockSync as jest.Mock).mockClear();
});

describe('summary and history', () => {
  it('shows the summary card and the history (newest first): signed qty, → qty_after on hand, who and when, reason', async () => {
    const { calls } = routeFetch(baseRoutes());
    await renderDetail();

    expect(callsTo(calls, 'GET', ITEM)).toHaveLength(1);
    expect(screen.getByTestId('inventory-detail-header-title')).toHaveTextContent('Iced Tea');
    expect(screen.getByTestId('inventory-summary-qty')).toHaveTextContent('9');
    expect(screen.getByTestId('inventory-summary-status')).toHaveTextContent('Low');
    expect(screen.getByTestId('inventory-summary-reorder')).toHaveTextContent('Reorder at 10');
    expect(screen.getByTestId('inventory-summary-value')).toHaveTextContent('₱108.00');
    expect(screen.getByTestId('inventory-summary-cost')).toHaveTextContent('₱12.00');

    const receiptId = `movement-${receipt.ulid}`;
    expect(screen.getByTestId(`${receiptId}-type`)).toHaveTextContent('Stock in');
    expect(screen.getByTestId(`${receiptId}-qty`)).toHaveTextContent('+24');
    expect(screen.getByTestId(`${receiptId}-after`)).toHaveTextContent('→ 33 on hand');
    // Branch time (Asia/Manila, UTC+8).
    expect(screen.getByTestId(`${receiptId}-meta`)).toHaveTextContent('Marco Manager · 27 Sep 2026, 10:00 AM');
    expect(screen.getByTestId(`${receiptId}-reason`)).toHaveTextContent('Delivery');
    expect(screen.getByTestId(`${receiptId}-cost`)).toHaveTextContent('Unit cost ₱12.00');

    const saleId = `movement-${sale.ulid}`;
    expect(screen.getByTestId(`${saleId}-type`)).toHaveTextContent('Sale');
    expect(screen.getByTestId(`${saleId}-qty`)).toHaveTextContent('-2');
    expect(screen.getByTestId(`${saleId}-after`)).toHaveTextContent('→ 9 on hand');
    expect(screen.queryByTestId(`${saleId}-cost`)).toBeNull();
  });

  it('a sale shows its order reference, which opens the order', async () => {
    routeFetch(baseRoutes());
    await renderDetail();

    const reference = screen.getByTestId(`movement-${sale.ulid}-reference`);
    expect(reference).toHaveTextContent(/INV-MAIN-00000042$/);
    await fireEvent.press(reference);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/orders/[ulid]', params: { ulid: '01K62Z3K5Q9V7X2M4N6P8R0T1W' } });
  });

  it('pages the history on scroll and filters it by type', async () => {
    const { calls } = routeFetch(baseRoutes());
    await renderDetail();

    await act(async () => {
      fireEvent(screen.getByTestId('inventory-history'), 'onEndReached');
    });
    expect(await screen.findByTestId(`movement-${opening.ulid}`)).toBeOnTheScreen();
    // A movement with no author shows only its time.
    expect(screen.getByTestId(`movement-${opening.ulid}-meta`)).toHaveTextContent(/^20 Sep 2026, 8:00 AM$/);
    expect(callsTo(calls, 'GET', MOVEMENTS).map((call) => call.query.get('cursor'))).toEqual([null, 'CUR2']);

    await fireEvent.press(screen.getByTestId('inventory-type-sale'));
    await waitFor(() => expect(callsTo(calls, 'GET', MOVEMENTS).at(-1)?.query.get('type')).toBe('sale'));
    await fireEvent.press(screen.getByTestId('inventory-type-all'));
    await waitFor(() => expect(callsTo(calls, 'GET', MOVEMENTS).at(-1)?.query.has('type')).toBe(false));
  });

  it('an empty history and a history error (with Retry)', async () => {
    let fail = true;
    routeFetch(
      baseRoutes({
        movements: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, page([], null, MOVEMENTS))),
      }),
    );
    await renderWithQuery(<InventoryItemRoute />);

    expect(await screen.findByTestId('inventory-history-error')).toHaveTextContent(/Server Error\./);
    fail = false;
    await fireEvent.press(screen.getByTestId('inventory-history-retry'));
    expect(await screen.findByTestId('inventory-history-empty')).toHaveTextContent(/No movements yet/);
  });

  it('409 (the product does not track stock): the message shows, the history still does, and there are no actions', async () => {
    routeFetch(
      baseRoutes({
        itemReply: () => mockResponse(409, { message: "This product doesn't track stock." }),
        movements: () => mockResponse(200, page([opening], null, MOVEMENTS)),
      }),
    );
    await renderWithQuery(<InventoryItemRoute />);

    expect(await screen.findByTestId('inventory-not-tracked')).toHaveTextContent(/This product doesn't track stock./);
    expect(await screen.findByTestId(`movement-${opening.ulid}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('inventory-summary')).toBeNull();
    expect(screen.queryByTestId('inventory-actions')).toBeNull();
    expect(screen.getByTestId('inventory-detail-header-title')).toHaveTextContent('Stock history');
  });

  it('404: "Not found"; another error offers Retry', async () => {
    let status = 404;
    const { calls } = routeFetch(
      baseRoutes({
        itemReply: () =>
          status === 200 ? mockResponse(200, { data: icedTea }) : mockResponse(status, { message: status === 404 ? 'Resource not found.' : 'Server Error.' }),
      }),
    );
    const { unmount } = await renderWithQuery(<InventoryItemRoute />);
    expect(await screen.findByTestId('record-error')).toHaveTextContent(/Not found/);
    await unmount();

    status = 500;
    await renderWithQuery(<InventoryItemRoute />);
    expect(await screen.findByTestId('record-error')).toHaveTextContent(/Server Error./);
    status = 200;
    await fireEvent.press(within(screen.getByTestId('record-error')).getByText('Retry'));
    expect(await screen.findByTestId('inventory-summary')).toBeOnTheScreen();
    expect(callsTo(calls, 'GET', ITEM).length).toBeGreaterThanOrEqual(3);
  });

  it('shows the card the list already loaded while GET /inventory/{product} loads; pull-to-refresh refetches it', async () => {
    const held = deferred<Response>();
    let first = true;
    const { calls } = routeFetch(
      baseRoutes({
        itemReply: () => {
          if (first) {
            first = false;
            return held.promise;
          }
          return mockResponse(200, { data: makeInventoryItem({ qty: 12, status: 'in_stock', stock_value_cents: 14400 }) });
        },
      }),
    );
    const client = createTestQueryClient();
    client.setQueryData(inventoryKeys.list({ search: '', categoryId: null, status: null }), {
      pages: [inventoryPage([makeInventoryItem({ qty: 7 })])],
      pageParams: [null],
    });
    await render(
      <QueryClientProvider client={client}>
        <InventoryItemRoute />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('inventory-summary-qty')).toHaveTextContent('7');
    await act(async () => {
      held.resolve(mockResponse(200, { data: makeInventoryItem({ qty: 9 }) }));
    });
    await waitFor(() => expect(screen.getByTestId('inventory-summary-qty')).toHaveTextContent('9'));

    await act(async () => {
      screen.getByTestId('inventory-history').props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(screen.getByTestId('inventory-summary-qty')).toHaveTextContent('12'));
    expect(callsTo(calls, 'GET', ITEM)).toHaveLength(2);
  });
});

describe('Stock in, Count and Wastage', () => {
  it('Stock in: the unit cost is prefilled; the body is typed receipt with its own ULID as Idempotency-Key; then everything refreshes and a stock sync runs', async () => {
    let itemVersion = 0;
    const { calls } = routeFetch([
      ...baseRoutes({ item: () => (itemVersion === 0 ? icedTea : makeInventoryItem({ qty: 33, status: 'in_stock', stock_value_cents: 39600 })) }),
      {
        method: 'POST',
        path: ADJUST,
        reply: () => {
          itemVersion = 1;
          return mockResponse(201, { data: makeStockMovement({ type: 'receipt', qty_delta: 24, qty_before: 9, qty_after: 33, reason: 'Delivery' }) });
        },
      },
    ]);
    await renderDetail();
    const historyLoads = callsTo(calls, 'GET', MOVEMENTS).length;

    await fireEvent.press(screen.getByTestId('inventory-action-receipt'));
    expect(screen.getByTestId('stock-receipt-dialog-cost').props.value).toBe('12.00');
    await fireEvent.changeText(screen.getByTestId('stock-receipt-dialog-qty'), '24');
    await fireEvent.changeText(screen.getByTestId('stock-receipt-dialog-cost'), '12.50');
    await fireEvent.changeText(screen.getByTestId('stock-receipt-dialog-reason'), ' Delivery ');
    await fireEvent.press(screen.getByTestId('stock-receipt-dialog-confirm'));

    await waitFor(() => expect(screen.getByTestId('inventory-summary-qty')).toHaveTextContent('33'));
    const [call] = callsTo(calls, 'POST', ADJUST);
    const body = jsonBody(call) as { ulid: string };
    expect(body).toEqual({ ulid: body.ulid, type: 'receipt', qty_delta: 24, reason: 'Delivery', unit_cost_cents: 1250 });
    expect(isUlid(body.ulid)).toBe(true);
    expect(keyOf(call)).toBe(body.ulid);
    expect(screen.getByTestId('inventory-notice')).toHaveTextContent(/Received 24 “Iced Tea”. 33 on hand.$/);
    expect(screen.getByTestId('inventory-summary-status')).toHaveTextContent('In stock');
    await waitFor(() => expect(callsTo(calls, 'GET', MOVEMENTS).length).toBeGreaterThan(historyLoads));
    expect(requestStockSync).toHaveBeenCalledTimes(1);
  });

  it('Stock in without a note sends reason null; a blank unit cost is left out', async () => {
    const { calls } = routeFetch([
      ...baseRoutes(),
      { method: 'POST', path: ADJUST, reply: () => mockResponse(201, { data: makeStockMovement({ type: 'receipt', reason: null }) }) },
    ]);
    await renderDetail();

    await fireEvent.press(screen.getByTestId('inventory-action-receipt'));
    await fireEvent.changeText(screen.getByTestId('stock-receipt-dialog-qty'), '6');
    await fireEvent.changeText(screen.getByTestId('stock-receipt-dialog-cost'), '');
    await fireEvent.press(screen.getByTestId('stock-receipt-dialog-confirm'));

    await waitFor(() => expect(callsTo(calls, 'POST', ADJUST)).toHaveLength(1));
    const body = jsonBody(callsTo(calls, 'POST', ADJUST)[0]) as Record<string, unknown>;
    expect(body).toEqual({ ulid: body.ulid, type: 'receipt', qty_delta: 6, reason: null });
  });

  it('Count sends counted_qty with a reason; Wastage sends a negative qty_delta with the quick pick, or the typed "Other…" reason', async () => {
    const { calls } = routeFetch([
      ...baseRoutes(),
      { method: 'POST', path: ADJUST, reply: () => mockResponse(201, { data: makeStockMovement({ qty_before: 9, qty_after: 8 }) }) },
    ]);
    await renderDetail();

    await fireEvent.press(screen.getByTestId('inventory-action-count'));
    await fireEvent.changeText(screen.getByTestId('stock-count-dialog-qty'), '8');
    await fireEvent.changeText(screen.getByTestId('stock-count-dialog-reason'), 'Weekly count');
    await fireEvent.press(screen.getByTestId('stock-count-dialog-confirm'));
    await waitFor(() => expect(callsTo(calls, 'POST', ADJUST)).toHaveLength(1));

    await fireEvent.press(screen.getByTestId('inventory-action-wastage'));
    await fireEvent.changeText(screen.getByTestId('stock-wastage-dialog-qty'), '2');
    await fireEvent.press(screen.getByTestId('stock-wastage-dialog-pick-Spoiled'));
    await fireEvent.press(screen.getByTestId('stock-wastage-dialog-confirm'));
    await waitFor(() => expect(callsTo(calls, 'POST', ADJUST)).toHaveLength(2));

    await fireEvent.press(screen.getByTestId('inventory-action-wastage'));
    await fireEvent.changeText(screen.getByTestId('stock-wastage-dialog-qty'), '1');
    await fireEvent.press(screen.getByTestId('stock-wastage-dialog-pick-other'));
    await fireEvent.changeText(screen.getByTestId('stock-wastage-dialog-reason'), 'Dropped');
    await fireEvent.press(screen.getByTestId('stock-wastage-dialog-confirm'));
    await waitFor(() => expect(callsTo(calls, 'POST', ADJUST)).toHaveLength(3));

    const [count, spoiled, dropped] = callsTo(calls, 'POST', ADJUST).map((call) => jsonBody(call) as Record<string, unknown>);
    expect(count).toEqual({ ulid: count.ulid, type: 'count', counted_qty: 8, reason: 'Weekly count' });
    expect(spoiled).toEqual({ ulid: spoiled.ulid, type: 'wastage', qty_delta: -2, reason: 'Spoiled' });
    expect(dropped).toEqual({ ulid: dropped.ulid, type: 'wastage', qty_delta: -1, reason: 'Dropped' });
    expect(new Set([count.ulid, spoiled.ulid, dropped.ulid]).size).toBe(3);
  });

  it('checks the fields before sending (quantity, reason, wastage pick, unit cost)', async () => {
    const { calls } = routeFetch(baseRoutes());
    await renderDetail();

    await fireEvent.press(screen.getByTestId('inventory-action-count'));
    await fireEvent.press(screen.getByTestId('stock-count-dialog-confirm'));
    expect(screen.getByTestId('stock-count-dialog-qty-error')).toHaveTextContent('Enter the counted quantity, a whole number from 0 to 100,000.');
    expect(screen.getByTestId('stock-count-dialog-reason-error')).toHaveTextContent('Enter a reason.');
    await fireEvent.press(screen.getByTestId('stock-count-dialog-cancel'));

    await fireEvent.press(screen.getByTestId('inventory-action-wastage'));
    await fireEvent.changeText(screen.getByTestId('stock-wastage-dialog-qty'), '0');
    await fireEvent.press(screen.getByTestId('stock-wastage-dialog-confirm'));
    expect(screen.getByTestId('stock-wastage-dialog-qty-error')).toHaveTextContent('Enter a whole number from 1 to 100,000.');
    expect(screen.getByTestId('stock-wastage-dialog-reason-error')).toHaveTextContent('Choose a reason.');
    await fireEvent.press(screen.getByTestId('stock-wastage-dialog-cancel'));

    await fireEvent.press(screen.getByTestId('inventory-action-receipt'));
    await fireEvent.changeText(screen.getByTestId('stock-receipt-dialog-qty'), '5');
    await fireEvent.changeText(screen.getByTestId('stock-receipt-dialog-cost'), '12.345');
    await fireEvent.press(screen.getByTestId('stock-receipt-dialog-confirm'));
    expect(screen.getByTestId('stock-receipt-dialog-cost-error')).toHaveTextContent('Enter a unit cost in pesos, e.g. 12.50.');

    expect(callsTo(calls, 'POST', ADJUST)).toHaveLength(0);
  });

  it('shows 422s under their fields (quantity sign, unit cost, reason)', async () => {
    let reply: 'sign' | 'cost' | 'below' = 'sign';
    routeFetch([
      ...baseRoutes(),
      {
        method: 'POST',
        path: ADJUST,
        reply: () => {
          if (reply === 'sign') return mockResponse(422, { message: 'Stock in must add stock.', errors: { qty_delta: ['Stock in must add stock.'] } });
          if (reply === 'cost') {
            return mockResponse(422, {
              message: 'The unit cost cents field must not be greater than 100000000.',
              errors: { unit_cost_cents: ['The unit cost cents field must not be greater than 100000000.'] },
            });
          }
          return mockResponse(422, {
            message: "Stock can't go below zero (9 on hand). (and 1 more error)",
            errors: { qty_delta: ["Stock can't go below zero (9 on hand)."], reason: ['The reason field is required.'] },
          });
        },
      },
    ]);
    await renderDetail();

    await fireEvent.press(screen.getByTestId('inventory-action-receipt'));
    await fireEvent.changeText(screen.getByTestId('stock-receipt-dialog-qty'), '5');
    await fireEvent.press(screen.getByTestId('stock-receipt-dialog-confirm'));
    expect(await screen.findByTestId('stock-receipt-dialog-qty-error')).toHaveTextContent('Stock in must add stock.');

    reply = 'cost';
    await fireEvent.press(screen.getByTestId('stock-receipt-dialog-confirm'));
    expect(await screen.findByTestId('stock-receipt-dialog-cost-error')).toHaveTextContent(
      'The unit cost cents field must not be greater than 100000000.',
    );
    await fireEvent.press(screen.getByTestId('stock-receipt-dialog-cancel'));

    reply = 'below';
    await fireEvent.press(screen.getByTestId('inventory-action-wastage'));
    await fireEvent.changeText(screen.getByTestId('stock-wastage-dialog-qty'), '30');
    await fireEvent.press(screen.getByTestId('stock-wastage-dialog-pick-Expired'));
    await fireEvent.press(screen.getByTestId('stock-wastage-dialog-confirm'));
    expect(await screen.findByTestId('stock-wastage-dialog-qty-error')).toHaveTextContent("Stock can't go below zero (9 on hand).");
    expect(screen.getByTestId('stock-wastage-dialog-reason-error')).toHaveTextContent('The reason field is required.');
  });

  it('a network error keeps the ULID: the fields lock and Retry resends the same body with the same key', async () => {
    let reply: 'network' | 'ok' = 'network';
    const { calls } = routeFetch([
      ...baseRoutes(),
      {
        method: 'POST',
        path: ADJUST,
        reply: () =>
          reply === 'network'
            ? Promise.reject(new TypeError('Network request failed'))
            : mockResponse(201, { data: makeStockMovement({ type: 'count', qty_before: 9, qty_after: 7 }) }),
      },
    ]);
    await renderDetail();

    await fireEvent.press(screen.getByTestId('inventory-action-count'));
    await fireEvent.changeText(screen.getByTestId('stock-count-dialog-qty'), '7');
    await fireEvent.changeText(screen.getByTestId('stock-count-dialog-reason'), 'Recount');
    await fireEvent.press(screen.getByTestId('stock-count-dialog-confirm'));

    expect(within(await screen.findByTestId('stock-count-dialog-error')).getByText("We couldn't confirm the adjustment. Retry.")).toBeOnTheScreen();
    expect(screen.getByTestId('stock-count-dialog-confirm')).toHaveTextContent('Retry');
    expect(screen.getByTestId('stock-count-dialog-qty').props.editable).toBe(false);

    // Closing and reopening keeps the pending attempt.
    await fireEvent.press(screen.getByTestId('stock-count-dialog-cancel'));
    await fireEvent.press(screen.getByTestId('inventory-action-count'));
    expect(screen.getByTestId('stock-count-dialog-qty').props.value).toBe('7');

    reply = 'ok';
    await fireEvent.press(screen.getByTestId('stock-count-dialog-confirm'));
    await waitFor(() => expect(screen.getByTestId('inventory-notice')).toHaveTextContent(/Counted “Iced Tea”: 9 → 7.$/));
    const [first, retry] = callsTo(calls, 'POST', ADJUST);
    expect(keyOf(retry)).toBe(keyOf(first));
    expect(jsonBody(retry)).toEqual(jsonBody(first));
  });
});

describe('reorder level', () => {
  it('Edit sets it (PUT reorder_level) and the summary shows the new level; Remove sends null', async () => {
    let level: number | null = 10;
    const { calls } = routeFetch([
      ...baseRoutes({ item: () => makeInventoryItem({ reorder_level: level, status: level !== null && level >= 9 ? 'low' : 'in_stock' }) }),
      {
        method: 'PUT',
        path: REORDER,
        reply: (call) => {
          level = (jsonBody(call) as { reorder_level: number | null }).reorder_level;
          return mockResponse(200, { data: makeInventoryItem({ reorder_level: level, status: level !== null && level >= 9 ? 'low' : 'in_stock' }) });
        },
      },
    ]);
    await renderDetail();

    await fireEvent.press(screen.getByTestId('inventory-reorder-edit'));
    expect(screen.getByTestId('reorder-dialog-level').props.value).toBe('10');
    await fireEvent.changeText(screen.getByTestId('reorder-dialog-level'), '5');
    await fireEvent.press(screen.getByTestId('reorder-dialog-confirm'));
    await waitFor(() => expect(screen.getByTestId('inventory-summary-reorder')).toHaveTextContent('Reorder at 5'));
    expect(screen.getByTestId('inventory-summary-status')).toHaveTextContent('In stock');
    expect(screen.getByTestId('inventory-notice')).toHaveTextContent(/Reorder level of “Iced Tea” set to 5.$/);

    await fireEvent.press(screen.getByTestId('inventory-reorder-edit'));
    await fireEvent.press(screen.getByTestId('reorder-dialog-remove'));
    await waitFor(() => expect(screen.getByTestId('inventory-summary-reorder')).toHaveTextContent('No reorder level'));

    expect(callsTo(calls, 'PUT', REORDER).map((call) => jsonBody(call))).toEqual([{ reorder_level: 5 }, { reorder_level: null }]);
    expect(requestStockSync).toHaveBeenCalledTimes(2);
  });

  it('checks the number, and shows a 422 under the field and a 409 as a banner', async () => {
    let reply = 422;
    const { calls } = routeFetch([
      ...baseRoutes(),
      {
        method: 'PUT',
        path: REORDER,
        reply: () =>
          reply === 422
            ? mockResponse(422, { message: 'The reorder level field must not be greater than 100000.', errors: { reorder_level: ['The reorder level field must not be greater than 100000.'] } })
            : mockResponse(409, { message: "This product doesn't track stock." }),
      },
    ]);
    await renderDetail();

    await fireEvent.press(screen.getByTestId('inventory-reorder-edit'));
    await fireEvent.changeText(screen.getByTestId('reorder-dialog-level'), '');
    await fireEvent.press(screen.getByTestId('reorder-dialog-confirm'));
    expect(screen.getByTestId('reorder-dialog-level-error')).toHaveTextContent('Enter a whole number from 0 to 100,000.');
    expect(callsTo(calls, 'PUT', REORDER)).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('reorder-dialog-level'), '99999');
    await fireEvent.press(screen.getByTestId('reorder-dialog-confirm'));
    expect(await screen.findByTestId('reorder-dialog-level-error')).toHaveTextContent('The reorder level field must not be greater than 100000.');

    reply = 409;
    await fireEvent.press(screen.getByTestId('reorder-dialog-confirm'));
    expect(within(await screen.findByTestId('reorder-dialog-error')).getByText("This product doesn't track stock.")).toBeOnTheScreen();
  });
});

describe('permissions', () => {
  it('report.view without inventory.adjust: read-only (no actions, no Edit), references still open orders', async () => {
    useSessionStore.getState().setSignedIn({ ...managerUser, permissions: ['report.view'] }, FUTURE);
    routeFetch(baseRoutes());
    await renderDetail();

    expect(screen.queryByTestId('inventory-actions')).toBeNull();
    expect(screen.queryByTestId('inventory-action-receipt')).toBeNull();
    expect(screen.queryByTestId('inventory-reorder-edit')).toBeNull();
    expect(screen.getByTestId('inventory-summary-reorder')).toHaveTextContent('Reorder at 10');
    await fireEvent.press(screen.getByTestId(`movement-${sale.ulid}-reference`));
    expect(router.push).toHaveBeenCalled();
  });

  it('inventory.adjust without Orders access: the reference is plain text', async () => {
    useSessionStore.getState().setSignedIn({ ...managerUser, permissions: ['inventory.adjust'] }, FUTURE);
    routeFetch(baseRoutes());
    await renderDetail();

    expect(screen.getByTestId('inventory-actions')).toBeOnTheScreen();
    const reference = screen.getByTestId(`movement-${sale.ulid}-reference`);
    expect(reference).toHaveTextContent('INV-MAIN-00000042');
    expect(reference.props.accessibilityRole).toBeUndefined();
  });

  it('an unknown product id shows "Not found"', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ productId: 'abc' });
    routeFetch(baseRoutes());
    await renderWithQuery(<InventoryItemRoute />);
    expect(await screen.findByTestId('record-error')).toHaveTextContent(/Not found/);
  });
});
