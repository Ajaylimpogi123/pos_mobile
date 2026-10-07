/**
 * §D1 Set cost (docs/api-contract.md → Ingredients, Recipes & Purchasing):
 * the preview math (`round_half_up(cost_cents / factor, 6)` with `BigInt`),
 * the dialog (pesos → centavos, the unit picker, 422s, the ULID kept on
 * Retry), the `inventory.adjust` gating on the inventory detail and the
 * ingredient edit screen, and the `revaluation` history entry and filter.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import IngredientRoute from '@/app/(app)/(admin)/ingredients/[id]';
import IngredientStockRoute from '@/app/(app)/(admin)/inventory/ingredients/[ingredientId]';
import { revaluationLabel } from '@/components/inventory/inventoryLabels';
import { ingredientCostPreview, validateIngredientCost } from '@/hooks/ingredients/useIngredientCost';
import { menuKeys } from '@/hooks/menu/queryKeys';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { makeIngredient, makeIngredientMovement, UNIT_CATALOG } from '@/test-utils/purchasing';
import { costPerBaseUnit, formatCostRate, stockValueCents } from '@/utils/quantity';
import { ingredientUnitChoices, type UnitChoices } from '@/utils/units';
import { isUlid } from '@/utils/ulid';

const FUTURE = '2099-09-25T01:30:00Z';
const ITEM = '/api/v1/inventory/ingredients/5';
const MOVEMENTS = `${ITEM}/movements`;
const COST = '/api/v1/admin/ingredients/5/cost';
const REVAL_ULID = '01K6REVAL0000000000000000A';

/** Example D1's starting point: Flour, 5,000 g at avg 4.000000 (value ₱200.00). */
const flourD1 = makeIngredient({ qty: '5000.000', avg_cost: '4.000000', stock_value_cents: 20000 });
const flourAfter = makeIngredient({ qty: '5000.000', avg_cost: '5.000000', stock_value_cents: 25000 });
const choices = ingredientUnitChoices(flourD1, UNIT_CATALOG);

/** What the fake server holds: the ingredient changes once a cost is saved, so refetches read the new cost. */
const server = { item: flourD1 };

function costSaved() {
  server.item = flourAfter;
  return mockResponse(200, { data: flourAfter });
}

function revaluation() {
  return makeIngredientMovement({
    ulid: REVAL_ULID,
    type: 'revaluation',
    qty_delta: '0.000',
    qty_after: '5000.000',
    entered_qty: '1.000',
    entered_unit: 'sack',
    unit_cost_cents: 125000,
    value_cents: 5000,
    reason: 'Supplier price list',
    reference: null,
  });
}

function detailRoutes(extra: Route[] = []): Route[] {
  return [
    { method: 'GET', path: ITEM, reply: () => mockResponse(200, { data: server.item }) },
    { method: 'GET', path: MOVEMENTS, reply: () => mockResponse(200, page([revaluation(), makeIngredientMovement()], null, MOVEMENTS)) },
    { method: 'GET', path: '/api/v1/units', reply: () => mockResponse(200, { data: UNIT_CATALOG }) },
    ...extra,
  ];
}

function callsTo(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

async function renderDetail() {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ ingredientId: '5' });
  const result = await renderWithQuery(<IngredientStockRoute />);
  await screen.findByTestId('ingredient-summary');
  return result;
}

async function openCostDialog() {
  await fireEvent.press(screen.getByTestId('ingredient-action-cost'));
  // The units load with the catalog; `sack` is one of Flour's own units.
  await screen.findByTestId('ingredient-cost-dialog-units-sack');
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  server.item = flourD1;
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  (router.replace as jest.Mock).mockClear();
  (router.push as jest.Mock).mockClear();
});

describe('preview math (BigInt, round_half_up to 6 decimals)', () => {
  it('example D1: ₱1,250 per sack of 25,000 g → 5.000000 centavos per g (₱0.05 / g)', () => {
    expect(costPerBaseUnit(125000, '25000.0000000000')).toBe('5.000000');
    expect(formatCostRate('5.000000')).toBe('₱0.05');
    const preview = ingredientCostPreview(flourD1, { amount: '1,250', unit: 'sack' }, choices);
    expect(preview).toMatchObject({ avgCost: '5.000000', perBase: '₱0.05 / g', perLarger: '₱50.00 / kg', valueFrom: 20000, valueTo: 25000, tooSmall: false });
  });

  it('rounds half up at 6 decimals and converts catalog units exactly', () => {
    // ₱1,400 for 30 kg: 140000 / 30000 = 4.6666666… → 4.666667.
    expect(costPerBaseUnit(140000, '30000')).toBe('4.666667');
    // ₱0.48 per g.
    expect(costPerBaseUnit(48, '1')).toBe('48.000000');
    // ₱10.00 per oz (28.349523125 g) = 35.273961949… → 35.273962.
    expect(costPerBaseUnit(1000, '28.349523125')).toBe('35.273962');
    expect(formatCostRate('4.666667')).toBe('₱0.0467');
    expect(formatCostRate('48.000000')).toBe('₱0.48');
    expect(stockValueCents('30000.000', '4.666667')).toBe(140000);
    expect(stockValueCents('-10.000', '4.000000')).toBe(0);
  });

  it('flags a cost that rounds to 0 per base unit (§D1 422 wording)', () => {
    const tiny: UnitChoices = { baseUnit: 'g', own: [{ code: 'silo', name: 'silo', factor: '100000000000', group: 'own' }], catalog: [] };
    expect(costPerBaseUnit(0, '1')).toBe('0.000000');
    const checked = validateIngredientCost({ amount: '0.01', unit: 'silo', reason: '' }, tiny);
    expect(checked.errors.cost_cents).toBe('The cost is too small for this unit.');
  });

  it('parses pesos into integer centavos and checks the limits', () => {
    expect(validateIngredientCost({ amount: '1,250.50', unit: 'sack', reason: '  ' }, choices).body).toEqual({ cost_cents: 125050, unit: 'sack' });
    expect(validateIngredientCost({ amount: '', unit: 'g', reason: '' }, choices).errors.cost_cents).toBe('Enter the cost.');
    expect(validateIngredientCost({ amount: '0', unit: 'g', reason: '' }, choices).errors.cost_cents).toBe('Enter a cost greater than ₱0.00.');
    expect(validateIngredientCost({ amount: '1000000.01', unit: 'g', reason: '' }, choices).errors.cost_cents).toBe('Enter at most ₱1,000,000.00.');
    expect(validateIngredientCost({ amount: '5', unit: 'tbsp', reason: '' }, choices).errors.unit).toBe('Choose a unit.');
  });
});

describe('Set cost dialog', () => {
  it('defaults to the base unit, previews live, and posts integer centavos per the picked unit; then refreshes', async () => {
    const { calls } = routeFetch(detailRoutes([{ method: 'POST', path: COST, reply: () => costSaved() }]));
    const { client } = await renderDetail();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await openCostDialog();
    expect(screen.getByTestId('ingredient-cost-dialog-amount')).toBeOnTheScreen();
    expect(screen.getByText('Cost of 1 g')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('ingredient-cost-dialog-units-sack'));
    await fireEvent.changeText(screen.getByTestId('ingredient-cost-dialog-amount'), '1,250');
    expect(screen.getByTestId('ingredient-cost-dialog-preview-rate')).toHaveTextContent('₱0.05 / g');
    expect(screen.getByTestId('ingredient-cost-dialog-preview-larger')).toHaveTextContent('= ₱50.00 / kg');
    expect(screen.getByTestId('ingredient-cost-dialog-preview-value')).toHaveTextContent('Stock value ₱200.00 → ₱250.00');
    await fireEvent.changeText(screen.getByTestId('ingredient-cost-dialog-reason'), 'Supplier price list');

    const movementsBefore = callsTo(calls, 'GET', MOVEMENTS).length;
    await fireEvent.press(screen.getByTestId('ingredient-cost-dialog-confirm'));
    await waitFor(() => expect(callsTo(calls, 'POST', COST)).toHaveLength(1));
    const post = callsTo(calls, 'POST', COST)[0] as FetchCall;
    const body = jsonBody(post) as { ulid: string };
    expect(isUlid(body.ulid)).toBe(true);
    expect(body).toEqual({ ulid: body.ulid, cost_cents: 125000, unit: 'sack', reason: 'Supplier price list' });
    expect((post.init.headers as Record<string, string>)['Idempotency-Key']).toBe(body.ulid);

    expect(await screen.findByTestId('ingredient-notice')).toHaveTextContent(/Cost of “Flour” set: ₱50\.00 \/ kg\./);
    expect(screen.getByTestId('ingredient-summary-cost')).toHaveTextContent('₱50.00 / kg');
    await waitFor(() => expect(callsTo(calls, 'GET', MOVEMENTS).length).toBeGreaterThan(movementsBefore));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: menuKeys.recipes() });
  });

  it('shows 422 field errors under their fields, and a new attempt after a 422 is a corrected request', async () => {
    let attempt = 0;
    const { calls } = routeFetch(
      detailRoutes([
        {
          method: 'POST',
          path: COST,
          reply: () => {
            attempt += 1;
            return attempt === 1
              ? mockResponse(422, {
                  message: 'The given data was invalid.',
                  errors: { cost_cents: ['The cost is too small for this unit.'], unit: ['Add "tbsp" to Flour\'s units first.'] },
                })
              : costSaved();
          },
        },
      ]),
    );
    await renderDetail();
    await openCostDialog();
    await fireEvent.changeText(screen.getByTestId('ingredient-cost-dialog-amount'), '0.01');
    await fireEvent.press(screen.getByTestId('ingredient-cost-dialog-confirm'));
    expect(await screen.findByTestId('ingredient-cost-dialog-amount-error')).toHaveTextContent('The cost is too small for this unit.');
    expect(screen.getByTestId('ingredient-cost-dialog-unit-error')).toHaveTextContent('Add "tbsp" to Flour\'s units first.');
    expect(screen.queryByTestId('ingredient-cost-dialog-error')).toBeNull();
    expect(screen.getByTestId('ingredient-cost-dialog-confirm')).toHaveTextContent(/Save cost/);

    // Editing clears the field's error.
    await fireEvent.changeText(screen.getByTestId('ingredient-cost-dialog-amount'), '0.05');
    expect(screen.queryByTestId('ingredient-cost-dialog-amount-error')).toBeNull();
    await fireEvent.press(screen.getByTestId('ingredient-cost-dialog-confirm'));
    await waitFor(() => expect(callsTo(calls, 'POST', COST)).toHaveLength(2));
    expect(jsonBody(callsTo(calls, 'POST', COST)[1] as FetchCall)).toMatchObject({ cost_cents: 5, unit: 'g' });
  });

  it('a network error locks the body and Retry resends it with the same ULID', async () => {
    let attempt = 0;
    const { calls } = routeFetch(
      detailRoutes([
        {
          method: 'POST',
          path: COST,
          reply: () => {
            attempt += 1;
            return attempt === 1 ? Promise.reject(new TypeError('Network request failed')) : costSaved();
          },
        },
      ]),
    );
    await renderDetail();
    await openCostDialog();
    await fireEvent.press(screen.getByTestId('ingredient-cost-dialog-units-kg'));
    await fireEvent.changeText(screen.getByTestId('ingredient-cost-dialog-amount'), '50');
    await fireEvent.press(screen.getByTestId('ingredient-cost-dialog-confirm'));
    expect(await screen.findByTestId('ingredient-cost-dialog-error')).toHaveTextContent(/We couldn't confirm the new cost\. Retry\./);
    expect(screen.getByTestId('ingredient-cost-dialog-confirm')).toHaveTextContent(/Retry/);

    await fireEvent.press(screen.getByTestId('ingredient-cost-dialog-confirm'));
    await waitFor(() => expect(callsTo(calls, 'POST', COST)).toHaveLength(2));
    const [first, second] = callsTo(calls, 'POST', COST) as [FetchCall, FetchCall];
    const body = jsonBody(first) as { ulid: string };
    expect(body).toEqual({ ulid: body.ulid, cost_cents: 5000, unit: 'kg' });
    expect(jsonBody(second)).toEqual(body);
    expect((second.init.headers as Record<string, string>)['Idempotency-Key']).toBe(body.ulid);
    expect(await screen.findByTestId('ingredient-notice')).toHaveTextContent(/Cost of “Flour” set/);
  });
});

describe('gating (inventory.adjust)', () => {
  it('report.view alone gets no Set cost on the inventory detail', async () => {
    useSessionStore.getState().setSignedIn({ ...cashierUser, permissions: ['report.view'] }, FUTURE);
    routeFetch(detailRoutes());
    await renderDetail();
    expect(screen.queryByTestId('ingredient-action-cost')).toBeNull();
  });

  it('the ingredient edit screen shows the cost card with inventory.adjust, and opens the dialog', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '5' });
    routeFetch([
      { method: 'GET', path: '/api/v1/admin/ingredients/5', reply: () => mockResponse(200, { data: server.item }) },
      { method: 'GET', path: '/api/v1/units', reply: () => mockResponse(200, { data: UNIT_CATALOG }) },
      { method: 'POST', path: COST, reply: () => costSaved() },
    ]);
    await renderWithQuery(<IngredientRoute />);
    await screen.findByTestId('ingredient-form-screen');
    expect(screen.getByTestId('ingredient-cost-average')).toHaveTextContent('₱40.00 / kg · ₱0.04 / g');
    await fireEvent.press(screen.getByTestId('ingredient-set-cost'));
    await screen.findByTestId('ingredient-cost-dialog-units-sack');
    await fireEvent.press(screen.getByTestId('ingredient-cost-dialog-units-sack'));
    await fireEvent.changeText(screen.getByTestId('ingredient-cost-dialog-amount'), '1250');
    await fireEvent.press(screen.getByTestId('ingredient-cost-dialog-confirm'));
    expect(await screen.findByTestId('ingredient-cost-notice')).toHaveTextContent(/Cost of “Flour” set: ₱50\.00 \/ kg\./);
    expect(screen.getByTestId('ingredient-cost-average')).toHaveTextContent('₱50.00 / kg · ₱0.05 / g');
  });

  it('product.manage without inventory.adjust edits the ingredient but gets no cost card', async () => {
    useSessionStore.getState().setSignedIn({ ...cashierUser, permissions: ['product.manage'] }, FUTURE);
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '5' });
    routeFetch([
      { method: 'GET', path: '/api/v1/admin/ingredients/5', reply: () => mockResponse(200, { data: server.item }) },
      { method: 'GET', path: '/api/v1/units', reply: () => mockResponse(200, { data: UNIT_CATALOG }) },
    ]);
    await renderWithQuery(<IngredientRoute />);
    await screen.findByTestId('ingredient-form-screen');
    expect(screen.queryByTestId('ingredient-cost-card')).toBeNull();
    expect(screen.queryByTestId('ingredient-set-cost')).toBeNull();
  });
});

describe('history', () => {
  it('labels a revaluation "Cost set · ₱1,250.00 / sack" with its value change, not a quantity', async () => {
    expect(revaluationLabel(125000, 'sack')).toBe('Cost set · ₱1,250.00 / sack');
    expect(revaluationLabel(null, 'sack')).toBe('Cost set');

    routeFetch(detailRoutes());
    await renderDetail();
    const row = `movement-${REVAL_ULID}`;
    expect(await screen.findByTestId(`${row}-type`)).toHaveTextContent('Cost set · ₱1,250.00 / sack');
    expect(screen.getByTestId(`${row}-qty`)).toHaveTextContent('+₱50.00');
    expect(screen.getByTestId(`${row}-after`)).toHaveTextContent('→ 5,000 g on hand');
    expect(screen.getByTestId(`${row}-reason`)).toHaveTextContent('Supplier price list');
    expect(screen.queryByTestId(`${row}-entered`)).toBeNull();
    expect(screen.queryByTestId(`${row}-value`)).toBeNull();
  });

  it('filters the history by type=revaluation', async () => {
    const { calls } = routeFetch(detailRoutes());
    await renderDetail();
    await fireEvent.press(await screen.findByTestId('ingredient-type-revaluation'));
    expect(screen.getByTestId('ingredient-type-revaluation')).toHaveTextContent(/Cost set/);
    await waitFor(() => expect(callsTo(calls, 'GET', MOVEMENTS).at(-1)?.query.get('type')).toBe('revaluation'));
  });
});
