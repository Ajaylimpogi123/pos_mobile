/**
 * Ingredients, Recipes & Purchasing §J / §L (Round B), in the app:
 * - the product form's stock mode selector (`Own stock` / `Recipe` /
 *   `Not tracked`), its PATCH body and the server's 409;
 * - the recipe builder on a recipe product's edit screen: the component
 *   picker (ingredients + own-stock products, never recipe products), the
 *   valid units per component, the live `BigInt` cost/margin preview
 *   (worked example J = ₱24.84), the PUT body, "Use as product cost", the
 *   per-line 422s and the offline message;
 * - the purchase item picker keeping `stock_mode = own` products;
 * - the ingredient history wording for recipe movements.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Network from 'expo-network';

import EditProductScreen from '@/app/(app)/(admin)/menu/products/[id]';
import NewProductScreen from '@/app/(app)/(admin)/menu/products/new';
import { IngredientMovementRow } from '@/components/inventory/IngredientMovementRow';
import { editProductRoute } from '@/constants/routes';
import type { AdminProduct, Recipe } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { mockResponse, resetWindowSize, secureStoreMock, setWindowSize, REFERENCE_SIZES } from '@/test-utils';
import { jsonBody, makeCategory, makeProduct, managerUser, page, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { makeIngredient, makeIngredientMovement, makeMilk, UNIT_CATALOG } from '@/test-utils/purchasing';
import { marginBps, recipeLineCostCents } from '@pos/core/recipe';

const FUTURE = '2099-09-25T01:30:00Z';
const RECIPE = '/api/v1/admin/products/20/recipe';

const flour = makeIngredient();
const milk = makeMilk();
const egg = makeIngredient({ id: 8, name: 'Egg', base_unit: 'pc', units: [], qty: '24.000', reorder_level: null, avg_cost: '800.000000' });
const pancake = makeProduct({ id: 20, name: 'Pancake', stock_mode: 'recipe', price_cents: 8500, cost_cents: 0 });
const icedTea = makeProduct({ id: 9, name: 'Iced Tea', stock_mode: 'own', cost_cents: 1500, stock_qty: 10 });
const waffle = makeProduct({ id: 21, name: 'Waffle', stock_mode: 'recipe' });

/** Worked example J, as the server returns it. */
const exampleJ: Recipe = {
  lines: [
    { component: { type: 'ingredient', id: 5, name: 'Flour', base_unit: 'g' }, qty: '1.000', unit: 'cup', base_qty: '120.000', unit_cost: '4.666667', line_cost_cents: 560 },
    { component: { type: 'ingredient', id: 8, name: 'Egg', base_unit: 'pc' }, qty: '1.000', unit: 'pc', base_qty: '1.000', unit_cost: '800.000000', line_cost_cents: 800 },
    { component: { type: 'ingredient', id: 6, name: 'Milk', base_unit: 'mL' }, qty: '0.500', unit: 'cup', base_qty: '118.294', unit_cost: '9.500000', line_cost_cents: 1124 },
  ],
  cost_cents: 2484,
  price_cents: 8500,
  // Q-031: trunc(6016 × 10000 / 8500) = 7077 (toward zero).
  margin_bps: 7077,
};

function builderRoutes(recipe: Recipe, extra: Route[] = []): Route[] {
  return [
    ...extra,
    { method: 'GET', path: '/api/v1/admin/categories', reply: () => mockResponse(200, page([makeCategory()], null, '/api/v1/admin/categories')) },
    { method: 'GET', path: '/api/v1/admin/products/20', reply: () => mockResponse(200, { data: pancake }) },
    { method: 'GET', path: RECIPE, reply: () => mockResponse(200, { data: recipe }) },
    { method: 'GET', path: '/api/v1/units', reply: () => mockResponse(200, { data: UNIT_CATALOG }) },
    { method: 'GET', path: '/api/v1/admin/ingredients', reply: () => mockResponse(200, page([flour, egg, milk], null, '/api/v1/admin/ingredients')) },
    { method: 'GET', path: '/api/v1/admin/ingredients/5', reply: () => mockResponse(200, { data: flour }) },
    { method: 'GET', path: '/api/v1/admin/ingredients/6', reply: () => mockResponse(200, { data: milk }) },
    { method: 'GET', path: '/api/v1/admin/ingredients/8', reply: () => mockResponse(200, { data: egg }) },
    { method: 'GET', path: '/api/v1/admin/products', reply: () => mockResponse(200, page([icedTea, waffle, pancake])) },
  ];
}

const emptyRecipe: Recipe = { lines: [], cost_cents: 0, price_cents: 8500, margin_bps: null };

function callsTo(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

async function openPancake() {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '20' });
  const result = await renderWithQuery(<EditProductScreen />);
  await screen.findByTestId('recipe-section');
  await waitFor(() => expect(screen.queryByTestId('recipe-loading')).toBeNull());
  return result;
}

async function addComponent(key: string) {
  await fireEvent.press(screen.getByTestId('recipe-add'));
  await fireEvent.press(await screen.findByTestId(`recipe-component-option-${key}`));
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.back as jest.Mock).mockClear();
  (router.replace as jest.Mock).mockClear();
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  (Network.useNetworkState as jest.Mock).mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
});

afterEach(() => {
  resetWindowSize();
});

describe('cost math (BigInt, round_half_up)', () => {
  it('matches worked example J: 560 + 800 + 1124 = ₱24.84', () => {
    expect(recipeLineCostCents('120.000', '4.666667')).toBe(560);
    expect(recipeLineCostCents('1.000', '800.000000')).toBe(800);
    expect(recipeLineCostCents('118.294', '9.500000')).toBe(1124);
    // Q-031: truncated toward zero, never rounded; null when the price or the cost is 0.
    expect(marginBps(8500, 2484)).toBe(7077);
    expect(marginBps(8500, 3044)).toBe(6418);
    expect(marginBps(3, 4)).toBe(-3333);
    expect(marginBps(0, 2484)).toBeNull();
    expect(marginBps(8500, 0)).toBeNull();
    expect(marginBps(2000, 2484)).toBe(-2420);
    // A product line: integer base_qty × the 6-decimal unit cost.
    expect(recipeLineCostCents(2, '1500.000000')).toBe(3000);
  });
});

describe('stock mode selector', () => {
  it('an own product with stock warns, PATCHes { stock_mode }, and shows the 409 in the banner and under the selector', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '9' });
    const { calls } = routeFetch([
      { method: 'GET', path: '/api/v1/admin/categories', reply: () => mockResponse(200, page([makeCategory()], null, '/api/v1/admin/categories')) },
      { method: 'GET', path: '/api/v1/admin/products/9', reply: () => mockResponse(200, { data: icedTea }) },
      { method: 'PATCH', path: '/api/v1/admin/products/9', reply: () => mockResponse(409, { message: 'Use up or write off the stock first.' }) },
    ]);
    await renderWithQuery(<EditProductScreen />);
    await screen.findByTestId('product-stock-mode');
    expect(screen.queryByTestId('product-stock-mode-warning')).toBeNull();

    await fireEvent.press(screen.getByTestId('product-stock-mode-none'));
    expect(screen.getByTestId('product-stock-mode-warning')).toHaveTextContent(/10 still in stock/);
    await fireEvent.press(screen.getByTestId('product-save'));

    expect(await screen.findByTestId('product-stock-mode-error')).toHaveTextContent('Use up or write off the stock first.');
    expect(screen.getByTestId('form-banner')).toHaveTextContent(/Use up or write off the stock first./);
    expect(jsonBody(callsTo(calls, 'PATCH', '/api/v1/admin/products/9')[0]!)).toEqual({ stock_mode: 'none' });
    expect(router.back).not.toHaveBeenCalled();
  });

  it('switching a saved product to Recipe stays on the screen and opens the recipe builder', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '20' });
    const plain = { ...pancake, stock_mode: 'none', track_stock: false } as AdminProduct;
    let current: AdminProduct = plain;
    const { calls } = routeFetch([
      { method: 'GET', path: '/api/v1/admin/products/20', reply: () => mockResponse(200, { data: current }) },
      {
        method: 'PATCH',
        path: '/api/v1/admin/products/20',
        reply: () => {
          current = pancake;
          return mockResponse(200, { data: pancake });
        },
      },
      ...builderRoutes(emptyRecipe),
    ]);
    await renderWithQuery(<EditProductScreen />);
    await screen.findByTestId('product-stock-mode');
    expect(screen.queryByTestId('recipe-section')).toBeNull();

    await fireEvent.press(screen.getByTestId('product-stock-mode-recipe'));
    expect(screen.getByTestId('product-recipe-hint')).toHaveTextContent('Save the product to build its recipe.');
    await fireEvent.press(screen.getByTestId('product-save'));

    expect(await screen.findByTestId('recipe-empty')).toBeOnTheScreen();
    expect(jsonBody(callsTo(calls, 'PATCH', '/api/v1/admin/products/20')[0]!)).toEqual({ stock_mode: 'recipe' });
    expect(router.back).not.toHaveBeenCalled();
    expect(callsTo(calls, 'GET', RECIPE)).toHaveLength(1);
  });

  it('creating a Recipe product sends stock_mode and reopens it as its edit screen', async () => {
    const created = makeProduct({ id: 12, name: 'Tapsilog', stock_mode: 'recipe' });
    const { calls } = routeFetch([
      { method: 'GET', path: '/api/v1/admin/categories', reply: () => mockResponse(200, page([makeCategory()], null, '/api/v1/admin/categories')) },
      { method: 'POST', path: '/api/v1/admin/products', reply: () => mockResponse(201, { data: created }) },
      { method: 'GET', path: '/api/v1/admin/products/12/recipe', reply: () => mockResponse(200, { data: emptyRecipe }) },
    ]);
    await renderWithQuery(<NewProductScreen />);
    await fireEvent.changeText(screen.getByTestId('product-name'), 'Tapsilog');
    await fireEvent.press(screen.getByTestId('category-picker'));
    await fireEvent.press(await screen.findByTestId('category-option-2'));
    await fireEvent.changeText(screen.getByTestId('product-price'), '95');
    await fireEvent.press(screen.getByTestId('product-stock-mode-recipe'));
    await fireEvent.press(screen.getByTestId('product-save'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(editProductRoute(12)));
    expect((jsonBody(callsTo(calls, 'POST', '/api/v1/admin/products')[0]!) as Record<string, unknown>).stock_mode).toBe('recipe');
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('recipe builder', () => {
  it('shows a saved recipe with the server’s line costs, cost per serving and margin', async () => {
    routeFetch(builderRoutes(exampleJ));
    await openPancake();

    expect(await screen.findByTestId('recipe-line-0-cost')).toHaveTextContent('₱5.60');
    expect(screen.getByTestId('recipe-line-1-cost')).toHaveTextContent('₱8.00');
    expect(screen.getByTestId('recipe-line-2-cost')).toHaveTextContent('₱11.24');
    expect(screen.getByTestId('recipe-cost')).toHaveTextContent('₱24.84');
    expect(screen.getByTestId('recipe-margin')).toHaveTextContent('70.8%');
    expect(screen.queryByTestId('recipe-preview-note')).toBeNull();
    expect(screen.getByTestId('recipe-save')).toBeDisabled();
  });

  it('an empty recipe (cost 0) shows the margin as a dash', async () => {
    routeFetch(builderRoutes(emptyRecipe));
    await openPancake();
    expect(screen.getByTestId('recipe-cost')).toHaveTextContent('₱0.00');
    expect(screen.getByTestId('recipe-margin')).toHaveTextContent('—');
  });

  it('builds example J from the picker with a live preview (₱24.84, 70.8%) and PUTs the lines', async () => {
    const { calls } = routeFetch(
      builderRoutes(emptyRecipe, [{ method: 'PUT', path: RECIPE, reply: () => mockResponse(200, { data: exampleJ }) }]),
    );
    await openPancake();
    expect(screen.getByTestId('recipe-empty')).toBeOnTheScreen();

    // The picker offers active ingredients only (2026-09-30): no products at all.
    await fireEvent.press(screen.getByTestId('recipe-add'));
    expect(await screen.findByTestId('recipe-component-option-ingredient-5')).toBeOnTheScreen();
    expect(screen.queryByTestId(/recipe-component-option-product-/)).toBeNull();
    await fireEvent.press(screen.getByTestId('recipe-component-option-ingredient-5'));

    // Flour: its own units and the mass units; never a volume unit it hasn't defined.
    expect(await screen.findByTestId('recipe-line-0-units-cup')).toBeOnTheScreen();
    expect(screen.getByTestId('recipe-line-0-units-kg')).toBeOnTheScreen();
    expect(screen.queryByTestId('recipe-line-0-units-tbsp')).toBeNull();
    await fireEvent.press(screen.getByTestId('recipe-line-0-units-cup'));
    await fireEvent.changeText(screen.getByTestId('recipe-line-0-qty'), '1');
    expect(screen.getByTestId('recipe-line-0-preview')).toHaveTextContent('= 120 g');
    expect(screen.getByTestId('recipe-line-0-cost')).toHaveTextContent('₱5.60');

    await addComponent('ingredient-8');
    await fireEvent.changeText(screen.getByTestId('recipe-line-1-qty'), '1');
    expect(screen.getByTestId('recipe-line-1-cost')).toHaveTextContent('₱8.00');

    await addComponent('ingredient-6');
    expect(screen.queryByTestId('recipe-line-2-units-g')).toBeNull();
    await fireEvent.press(screen.getByTestId('recipe-line-2-units-cup'));
    await fireEvent.changeText(screen.getByTestId('recipe-line-2-qty'), '0.5');
    expect(screen.getByTestId('recipe-line-2-cost')).toHaveTextContent('₱11.24');

    expect(screen.getByTestId('recipe-cost')).toHaveTextContent('₱24.84');
    expect(screen.getByTestId('recipe-margin')).toHaveTextContent('70.8%');
    expect(screen.getByTestId('recipe-preview-note')).toBeOnTheScreen();
    expect(screen.getByTestId('recipe-apply-cost')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('recipe-save'));
    expect(await screen.findByTestId('recipe-notice')).toHaveTextContent(/Recipe saved./);
    expect(jsonBody(callsTo(calls, 'PUT', RECIPE)[0]!)).toEqual({
      lines: [
        { component_type: 'ingredient', component_id: 5, qty: '1', unit: 'cup' },
        { component_type: 'ingredient', component_id: 8, qty: '1', unit: 'pc' },
        { component_type: 'ingredient', component_id: 6, qty: '0.5', unit: 'cup' },
      ],
    });
    expect(screen.queryByTestId('recipe-preview-note')).toBeNull();
    expect(screen.getByTestId('recipe-cost')).toHaveTextContent('₱24.84');
  });

  it('a saved own-stock product component still shows in pc, costs cost_cents × qty, and saves a whole qty', async () => {
    const withProduct: Recipe = {
      lines: [{ component: { type: 'product', id: 9, name: 'Iced Tea', base_unit: 'pc' }, qty: 1, unit: 'pc', base_qty: 1, unit_cost: '1500.000000', line_cost_cents: 1500 }],
      cost_cents: 1500,
      price_cents: 8500,
      margin_bps: 8235,
    };
    const { calls } = routeFetch(
      builderRoutes(withProduct, [{ method: 'PUT', path: RECIPE, reply: () => mockResponse(200, { data: withProduct }) }]),
    );
    await openPancake();

    expect(await screen.findByTestId('recipe-line-0-units-single')).toHaveTextContent('Unit: pc');
    await fireEvent.changeText(screen.getByTestId('recipe-line-0-qty'), '2');
    expect(screen.getByTestId('recipe-line-0-cost')).toHaveTextContent('₱30.00');

    // A product's quantity is whole (Q-031): refused before sending.
    await fireEvent.changeText(screen.getByTestId('recipe-line-0-qty'), '1.5');
    await fireEvent.press(screen.getByTestId('recipe-save'));
    expect(await screen.findByText('A product quantity must be a whole number.')).toBeOnTheScreen();
    expect(callsTo(calls, 'PUT', RECIPE)).toHaveLength(0);

    // Q-031: a product line's qty is sent as an integer.
    await fireEvent.changeText(screen.getByTestId('recipe-line-0-qty'), '2');
    await fireEvent.press(screen.getByTestId('recipe-save'));
    await waitFor(() => expect(callsTo(calls, 'PUT', RECIPE)).toHaveLength(1));
    expect(jsonBody(callsTo(calls, 'PUT', RECIPE)[0]!)).toEqual({ lines: [{ component_type: 'product', component_id: 9, qty: 2, unit: 'pc' }] });
  });

  it('shows 422s under their line and anything else in the recipe banner', async () => {
    let status = 422;
    routeFetch(
      builderRoutes(emptyRecipe, [
        {
          method: 'PUT',
          path: RECIPE,
          reply: () =>
            status === 422
              ? mockResponse(422, {
                  message: 'The quantity is too small for this unit. (and 1 more error)',
                  errors: { 'lines.0.qty': ['The quantity is too small for this unit.'], 'lines.0.unit': ['Add "tbsp" to Flour\'s units first.'] },
                })
              : mockResponse(409, { message: 'This product doesn’t use a recipe.' }),
        },
      ]),
    );
    await openPancake();
    await addComponent('ingredient-5');
    await fireEvent.changeText(await screen.findByTestId('recipe-line-0-qty'), '0.001');
    await fireEvent.press(screen.getByTestId('recipe-line-0-units-mg'));
    await fireEvent.press(screen.getByTestId('recipe-save'));

    expect(await screen.findByText('The quantity is too small for this unit.')).toBeOnTheScreen();
    expect(screen.getByTestId('recipe-line-0-unit-error')).toHaveTextContent('Add "tbsp" to Flour\'s units first.');
    expect(screen.queryByTestId('recipe-banner')).toBeNull();

    // Typing clears that line's error.
    await fireEvent.changeText(screen.getByTestId('recipe-line-0-qty'), '5');
    expect(screen.queryByText('The quantity is too small for this unit.')).toBeNull();

    status = 409;
    await fireEvent.press(screen.getByTestId('recipe-save'));
    expect(await screen.findByTestId('recipe-banner')).toHaveTextContent(/This product doesn’t use a recipe./);
  });

  it('editing a saved line previews the new cost; Discard restores the server’s numbers', async () => {
    routeFetch(builderRoutes(exampleJ));
    await openPancake();
    await screen.findByTestId('recipe-line-0-units-cup');

    await fireEvent.changeText(screen.getByTestId('recipe-line-0-qty'), '2');
    // 240 g × 4.666667 = 1120.00008 → 1120; 1120 + 800 + 1124 = 3044.
    expect(screen.getByTestId('recipe-line-0-cost')).toHaveTextContent('₱11.20');
    expect(screen.getByTestId('recipe-cost')).toHaveTextContent('₱30.44');
    expect(screen.getByTestId('recipe-margin')).toHaveTextContent('64.2%');

    await fireEvent.press(screen.getByTestId('recipe-discard'));
    expect(screen.getByTestId('recipe-cost')).toHaveTextContent('₱24.84');
    expect(screen.getByTestId('recipe-line-0-qty').props.value).toBe('1');
  });

  it('Use as product cost POSTs apply-cost and fills the cost field', async () => {
    const { calls } = routeFetch(
      builderRoutes(exampleJ, [
        { method: 'POST', path: `${RECIPE}/apply-cost`, reply: () => mockResponse(200, { data: { ...pancake, cost_cents: 2484 } }) },
      ]),
    );
    await openPancake();
    expect(screen.getByTestId('product-cost').props.value).toBe('0.00');

    await fireEvent.press(await screen.findByTestId('recipe-apply-cost'));
    expect(await screen.findByTestId('recipe-notice')).toHaveTextContent(/Product cost set to ₱24.84./);
    expect(screen.getByTestId('product-cost').props.value).toBe('24.84');
    expect(callsTo(calls, 'POST', `${RECIPE}/apply-cost`)).toHaveLength(1);
  });

  it('offline: shows "Recipes need a connection." and loads nothing', async () => {
    (Network.useNetworkState as jest.Mock).mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    const { calls } = routeFetch(builderRoutes(exampleJ));
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '20' });
    await renderWithQuery(<EditProductScreen />);

    expect(await screen.findByTestId('recipe-offline')).toHaveTextContent(/Recipes need a connection./);
    expect(callsTo(calls, 'GET', RECIPE)).toHaveLength(0);
    expect(screen.queryByTestId('recipe-save')).toBeNull();
  });

  it('keeps recipe edits when the tablet rotates', async () => {
    setWindowSize(REFERENCE_SIZES.tabletPortrait.width, REFERENCE_SIZES.tabletPortrait.height);
    routeFetch(builderRoutes(exampleJ));
    await openPancake();
    await screen.findByTestId('recipe-line-0-units-cup');
    await fireEvent.changeText(screen.getByTestId('recipe-line-0-qty'), '2');

    await act(async () => {
      setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);
    });
    expect(screen.getByTestId('recipe-line-0-qty').props.value).toBe('2');
    expect(screen.getByTestId('recipe-cost')).toHaveTextContent('₱30.44');
  });
});

describe('ingredient history wording (§J)', () => {
  it('reads sale as used, void as returned, and a refund’s wastage entry as wasted with its entered quantity', async () => {
    const rows = [
      makeIngredientMovement({ ulid: 'SALE', type: 'sale', qty_delta: '-120.000', reference: { kind: 'order', ulid: 'O1', label: 'INV-1' } }),
      makeIngredientMovement({ ulid: 'VOID', type: 'void', qty_delta: '120.000', reference: { kind: 'order', ulid: 'O1', label: 'INV-1' } }),
      makeIngredientMovement({
        ulid: 'REFUND',
        type: 'wastage',
        qty_delta: '0.000',
        qty_after: '29880.000',
        entered_qty: '60.000',
        entered_unit: 'g',
        unit_cost_cents: null,
        value_cents: 0,
        reason: 'Refund INV-2: Burnt',
        reference: { kind: 'refund', ulid: 'O2', label: 'INV-2' },
      }),
      makeIngredientMovement({ ulid: 'WASTE', type: 'wastage', qty_delta: '-50.000', entered_qty: '50.000', entered_unit: 'g', reference: null }),
      makeIngredientMovement({ ulid: 'RECEIPT' }),
    ];
    await render(
      <>
        {rows.map((movement) => (
          <IngredientMovementRow key={movement.ulid} movement={movement} baseUnit="g" timeZone="Asia/Manila" />
        ))}
      </>,
    );
    expect(screen.getByTestId('movement-SALE-type')).toHaveTextContent('Used · sale');
    expect(screen.getByTestId('movement-VOID-type')).toHaveTextContent('Returned · void');
    expect(screen.getByTestId('movement-REFUND-type')).toHaveTextContent('Wasted · refund');
    expect(screen.getByTestId('movement-REFUND-qty')).toHaveTextContent('60 g');
    expect(screen.queryByTestId('movement-REFUND-entered')).toBeNull();
    expect(screen.getByTestId('movement-REFUND-reason')).toHaveTextContent('Refund INV-2: Burnt');
    // A plain wastage keeps its label and its signed base delta.
    expect(screen.getByTestId('movement-WASTE-type')).toHaveTextContent('Wastage');
    expect(screen.getByTestId('movement-WASTE-qty')).toHaveTextContent('-50 g');
    expect(screen.getByTestId('movement-RECEIPT-type')).toHaveTextContent('Stock in');
  });
});
