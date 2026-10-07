/**
 * Inventory → Ingredients (docs/api-contract.md → Ingredients, Recipes &
 * Purchasing §D, §L): the `Products | Ingredients` switch, the list (base
 * units with a friendlier unit, status, summary), the detail (average cost,
 * history with the entered qty and unit, the PO link), the adjust dialogs with
 * a unit picker (idempotent, Retry), and the reorder level in any unit.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import IngredientStockRoute from '@/app/(app)/(admin)/inventory/ingredients/[ingredientId]';
import IngredientStockIndexRoute from '@/app/(app)/(admin)/inventory/ingredients/index';
import InventoryIndexRoute from '@/app/(app)/(admin)/inventory/index';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { inventoryPage } from '@/test-utils/inventory';
import { makeIngredient, makeIngredientAdjustment, makeIngredientMovement, makeMilk, PO_ULID, UNIT_CATALOG } from '@/test-utils/purchasing';
import { isUlid } from '@/utils/ulid';

const FUTURE = '2099-09-25T01:30:00Z';
const LIST = '/api/v1/inventory/ingredients';
const ITEM = `${LIST}/5`;
const ADJUST = '/api/v1/admin/ingredients/5/stock-adjustments';

const SUMMARY = { tracked: 12, low: 2, out: 1 };

function listPage(items = [makeIngredient(), makeMilk({ status: 'low' })]) {
  const base = page(items, null, LIST);
  return { ...base, meta: { ...base.meta, summary: SUMMARY } };
}

function detailRoutes(extra: Route[] = []): Route[] {
  return [
    { method: 'GET', path: ITEM, reply: () => mockResponse(200, { data: makeIngredient() }) },
    {
      method: 'GET',
      path: `${ITEM}/movements`,
      reply: () =>
        mockResponse(
          200,
          page(
            [
              makeIngredientMovement({ ulid: '01K6WASTE0000000000000000A', type: 'wastage', qty_delta: '-240.000', qty_after: '29760.000', entered_qty: '2.000', entered_unit: 'cup', value_cents: -1120, reason: 'Spoiled', reference: null }),
              makeIngredientMovement(),
            ],
            null,
            `${ITEM}/movements`,
          ),
        ),
    },
    { method: 'GET', path: '/api/v1/units', reply: () => mockResponse(200, { data: UNIT_CATALOG }) },
    ...extra,
  ];
}

function callsTo(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

async function renderDetail() {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ingredientId: '5' });
  await renderWithQuery(<IngredientStockRoute />);
  await screen.findByTestId('ingredient-summary');
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  (router.replace as jest.Mock).mockClear();
  (router.push as jest.Mock).mockClear();
});

it('the Products list switches to Ingredients', async () => {
  routeFetch([{ method: 'GET', path: '/api/v1/inventory', reply: () => mockResponse(200, inventoryPage([])) }]);
  await renderWithQuery(<InventoryIndexRoute />);
  await fireEvent.press(screen.getByTestId('inventory-kind-ingredients'));
  expect(router.replace).toHaveBeenLastCalledWith('/inventory/ingredients');
});

it('lists ingredients in base units with a friendlier unit, status and value; filters by status', async () => {
  const { calls } = routeFetch([{ method: 'GET', path: LIST, reply: () => mockResponse(200, listPage()) }]);
  await renderWithQuery(<IngredientStockIndexRoute />);
  expect(await screen.findByTestId('ingredient-card-5-qty')).toHaveTextContent('30,000 g');
  expect(screen.getByTestId('ingredient-card-5-friendly')).toHaveTextContent('30 kg');
  expect(screen.getByTestId('ingredient-card-5-reorder')).toHaveTextContent('Reorder at 5,000 g');
  expect(screen.getByTestId('ingredient-card-5-value')).toHaveTextContent('₱1,400.00');
  expect(screen.getByTestId('ingredient-card-6-status')).toHaveTextContent(/Low/);
  expect(screen.getByTestId('ingredient-stock-segment-low')).toHaveTextContent('Low (2)');

  await fireEvent.press(screen.getByTestId('ingredient-stock-segment-out'));
  await waitFor(() => expect(calls.at(-1)?.query.get('status')).toBe('out'));
  await fireEvent.press(screen.getByTestId('ingredient-card-5-open'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/inventory/ingredients/[ingredientId]', params: { ingredientId: '5' } });
});

it('the dashboard alerts view opens Low & out', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ status: 'alerts' });
  const { calls } = routeFetch([{ method: 'GET', path: LIST, reply: () => mockResponse(200, listPage()) }]);
  await renderWithQuery(<IngredientStockIndexRoute />);
  await screen.findByTestId('ingredient-stock-segment-alerts');
  expect(calls[0]?.query.get('status')).toBe('alerts');
});

it('the detail shows the average cost and the history with the entered qty and unit, and links the PO', async () => {
  routeFetch(detailRoutes());
  await renderDetail();
  expect(screen.getByTestId('ingredient-summary-qty')).toHaveTextContent('30,000 g');
  expect(screen.getByTestId('ingredient-summary-cost')).toHaveTextContent('₱46.67 / kg');

  const wasted = 'movement-01K6WASTE0000000000000000A';
  expect(await screen.findByTestId(`${wasted}-qty`)).toHaveTextContent('-240 g');
  expect(screen.getByTestId(`${wasted}-entered`)).toHaveTextContent('Entered 2 cup');
  expect(screen.getByTestId(`${wasted}-value`)).toHaveTextContent('Value -₱11.20');
  expect(screen.getByTestId(`${wasted}-after`)).toHaveTextContent('→ 29,760 g on hand');

  const receipt = 'movement-01K6RCPT00000000000000000A';
  expect(screen.getByTestId(`${receipt}-entered`)).toHaveTextContent('Entered 1 sack');
  await fireEvent.press(screen.getByTestId(`${receipt}-reference`));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/purchasing/orders/[ulid]', params: { ulid: PO_ULID } });
});

it('wastage: a quantity in any valid unit with a reason pick, sent negative with its own ULID; Retry keeps it', async () => {
  let attempt = 0;
  const { calls } = routeFetch(
    detailRoutes([
      {
        method: 'POST',
        path: ADJUST,
        reply: () => {
          attempt += 1;
          return attempt === 1 ? Promise.reject(new TypeError('Network request failed')) : mockResponse(201, { data: makeIngredientAdjustment() });
        },
      },
    ]),
  );
  await renderDetail();
  await fireEvent.press(screen.getByTestId('ingredient-action-wastage'));
  await fireEvent.press(screen.getByTestId('ingredient-wastage-dialog-units-cup'));
  await fireEvent.changeText(screen.getByTestId('ingredient-wastage-dialog-qty'), '2');
  expect(screen.getByTestId('ingredient-wastage-dialog-preview')).toHaveTextContent('= 240 g');
  await fireEvent.press(screen.getByTestId('ingredient-wastage-dialog-confirm'));
  expect(screen.getByTestId('ingredient-wastage-dialog-reason-error')).toHaveTextContent('Choose a reason.');

  await fireEvent.press(screen.getByTestId('ingredient-wastage-dialog-pick-Spoiled'));
  await fireEvent.press(screen.getByTestId('ingredient-wastage-dialog-confirm'));
  expect(await screen.findByTestId('ingredient-wastage-dialog-error')).toHaveTextContent(/couldn't confirm/);
  expect(screen.getByTestId('ingredient-wastage-dialog-confirm')).toHaveTextContent(/Retry/);

  await fireEvent.press(screen.getByTestId('ingredient-wastage-dialog-confirm'));
  await waitFor(() => expect(callsTo(calls, 'POST', ADJUST)).toHaveLength(2));
  const [first, second] = callsTo(calls, 'POST', ADJUST) as [FetchCall, FetchCall];
  const body = jsonBody(first) as { ulid: string };
  expect(isUlid(body.ulid)).toBe(true);
  expect(body).toEqual({ ulid: body.ulid, type: 'wastage', qty: '-2', unit: 'cup', reason: 'Spoiled' });
  expect(jsonBody(second)).toEqual(body);
  expect((second.init.headers as Record<string, string>)['Idempotency-Key']).toBe(body.ulid);
  // Q-026: the 201's `qty_after` (base units) is what the notice shows.
  expect(await screen.findByTestId('ingredient-notice')).toHaveTextContent(/Wasted 2 cup of “Flour”\. 29,760 g on hand\./);
});

it('an adjustment is signed by Add / Remove; a count may be 0', async () => {
  const { calls } = routeFetch(detailRoutes([{ method: 'POST', path: ADJUST, reply: () => mockResponse(201, { data: makeIngredientAdjustment() }) }]));
  await renderDetail();
  await fireEvent.press(screen.getByTestId('ingredient-action-adjustment'));
  await fireEvent.press(screen.getByTestId('ingredient-adjust-remove'));
  await fireEvent.press(screen.getByTestId('ingredient-adjustment-dialog-units-kg'));
  await fireEvent.changeText(screen.getByTestId('ingredient-adjustment-dialog-qty'), '1.5');
  await fireEvent.changeText(screen.getByTestId('ingredient-adjustment-dialog-reason'), 'Spilled sack');
  await fireEvent.press(screen.getByTestId('ingredient-adjustment-dialog-confirm'));
  await waitFor(() => expect(callsTo(calls, 'POST', ADJUST)).toHaveLength(1));
  expect(jsonBody(callsTo(calls, 'POST', ADJUST)[0] as FetchCall)).toMatchObject({ type: 'adjustment', qty: '-1.5', unit: 'kg', reason: 'Spilled sack' });

  await fireEvent.press(screen.getByTestId('ingredient-action-count'));
  await fireEvent.changeText(screen.getByTestId('ingredient-count-dialog-qty'), '0');
  await fireEvent.changeText(screen.getByTestId('ingredient-count-dialog-reason'), 'Weekly count');
  await fireEvent.press(screen.getByTestId('ingredient-count-dialog-confirm'));
  await waitFor(() => expect(callsTo(calls, 'POST', ADJUST)).toHaveLength(2));
  expect(jsonBody(callsTo(calls, 'POST', ADJUST)[1] as FetchCall)).toMatchObject({ type: 'count', qty: '0', unit: 'g' });
});

it('sets the reorder level in any valid unit, or removes it', async () => {
  const { calls } = routeFetch(
    detailRoutes([{ method: 'PUT', path: `${ITEM}/reorder-level`, reply: () => mockResponse(200, { data: makeIngredient({ reorder_level: '10000.000' }) }) }]),
  );
  await renderDetail();
  await fireEvent.press(screen.getByTestId('ingredient-reorder-edit'));
  await fireEvent.press(screen.getByTestId('ingredient-reorder-dialog-units-kg'));
  await fireEvent.changeText(screen.getByTestId('ingredient-reorder-dialog-qty'), '10');
  await fireEvent.press(screen.getByTestId('ingredient-reorder-dialog-confirm'));
  await waitFor(() => expect(callsTo(calls, 'PUT', `${ITEM}/reorder-level`)).toHaveLength(1));
  expect(jsonBody(callsTo(calls, 'PUT', `${ITEM}/reorder-level`)[0] as FetchCall)).toEqual({ reorder_level: { qty: '10', unit: 'kg' } });

  await fireEvent.press(screen.getByTestId('ingredient-reorder-edit'));
  await fireEvent.press(screen.getByTestId('ingredient-reorder-dialog-remove'));
  await waitFor(() => expect(callsTo(calls, 'PUT', `${ITEM}/reorder-level`)).toHaveLength(2));
  expect(jsonBody(callsTo(calls, 'PUT', `${ITEM}/reorder-level`)[1] as FetchCall)).toEqual({ reorder_level: null });
});

it('report.view alone reads the stock but gets no actions', async () => {
  useSessionStore.getState().setSignedIn({ ...cashierUser, permissions: ['report.view'] }, FUTURE);
  routeFetch(detailRoutes());
  await renderDetail();
  expect(screen.queryByTestId('ingredient-actions')).toBeNull();
  expect(screen.queryByTestId('ingredient-reorder-edit')).toBeNull();
});
