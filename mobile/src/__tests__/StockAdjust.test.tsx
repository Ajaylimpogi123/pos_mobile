/**
 * Stock on the admin menu (contract → Core Sale → stock-adjustments, admin
 * `Product.stock_qty`, App → Admin menu): the quantity on hand for
 * `track_stock` products, and the idempotent "Adjust stock" dialog.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import EditProductScreen from '@/app/(app)/(admin)/menu/products/[id]';
import AdminProductsScreen from '@/app/(app)/(admin)/menu/products/index';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import {
  jsonBody,
  makeCategory,
  makeProduct,
  managerUser,
  page,
  renderWithQuery,
  routeFetch,
  type FetchCall,
  type Route,
} from '@/test-utils/catalog';
import { makeStockMovement } from '@/test-utils/sale';
import { isUlid } from '@/utils/ulid';

const FUTURE = '2099-09-25T01:30:00Z';
const ADJUST = '/api/v1/admin/products/9/stock-adjustments';

const icedTea = makeProduct({
  id: 9,
  category: { id: 3, name: 'Drinks' },
  sku: 'DRK-001',
  name: 'Iced Tea',
  price_cents: 3500,
  cost_cents: 1500,
  track_stock: true,
  stock_qty: 26,
});

const productRoute: Route = {
  method: 'GET',
  path: '/api/v1/admin/products/9',
  reply: () => mockResponse(200, { data: icedTea }),
};

/** The edit form's category picker loads the admin categories. */
const categoriesRoute: Route = {
  method: 'GET',
  path: '/api/v1/admin/categories',
  reply: () => mockResponse(200, page([makeCategory({ id: 3, name: 'Drinks' })], null, '/api/v1/admin/categories')),
};

function adjustRoute(reply: Route['reply']): Route {
  return { method: 'POST', path: ADJUST, reply };
}

function adjustCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method === 'POST' && call.path === ADJUST);
}

function keyOf(call: FetchCall): string {
  return (call.init.headers as Record<string, string>)['Idempotency-Key'];
}

async function renderEdit() {
  const result = await renderWithQuery(<EditProductScreen />);
  await screen.findByTestId('stock-card');
  // Let the category picker's own query settle too, so no update lands after the test.
  await waitFor(() => expect(result.client.isFetching()).toBe(0));
  return result;
}

async function adjust(mode: 'add' | 'remove' | 'count', qty: string, reason: string) {
  await fireEvent.press(screen.getByTestId('stock-adjust'));
  await fireEvent.press(screen.getByTestId(`stock-mode-${mode}`));
  await fireEvent.changeText(screen.getByTestId('stock-qty'), qty);
  await fireEvent.changeText(screen.getByTestId('stock-reason'), reason);
  await fireEvent.press(screen.getByTestId('stock-dialog-confirm'));
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '9' });
});

describe('stock on the product cards', () => {
  it('shows stock_qty for track_stock products only, in red at 0', async () => {
    routeFetch([
      {
        method: 'GET',
        path: '/api/v1/admin/categories',
        reply: () => mockResponse(200, page([makeCategory()], null, '/api/v1/admin/categories')),
      },
      {
        method: 'GET',
        path: '/api/v1/admin/products',
        reply: () =>
          mockResponse(200, page([makeProduct(), icedTea, makeProduct({ id: 10, name: 'Bottled Water', track_stock: true, stock_qty: 0 })])),
      },
    ]);

    await renderWithQuery(<AdminProductsScreen />);
    await screen.findByTestId('product-card-9');

    expect(screen.getByTestId('product-card-9-stock')).toHaveTextContent(/26 in stock$/);
    expect(screen.getByTestId('product-card-10-stock')).toHaveTextContent(/0 in stock$/);
    expect(screen.queryByTestId('product-card-7-stock')).toBeNull();
  });
});

describe('Adjust stock', () => {
  it('Add: POST qty_delta with a reason and its own ULID as Idempotency-Key; the new quantity shows at once', async () => {
    const { calls } = routeFetch([categoriesRoute, productRoute, adjustRoute(() => mockResponse(201, { data: makeStockMovement() }))]);
    await renderEdit();
    expect(screen.getByTestId('stock-on-hand')).toHaveTextContent('26');

    await adjust('add', '24', '  Delivery from supplier ');

    await waitFor(() => expect(screen.getByTestId('stock-on-hand')).toHaveTextContent('50'));
    const [call] = adjustCalls(calls);
    const body = jsonBody(call) as { ulid: string };
    expect(body).toEqual({ ulid: body.ulid, qty_delta: 24, reason: 'Delivery from supplier' });
    expect(isUlid(body.ulid)).toBe(true);
    expect(keyOf(call)).toBe(body.ulid);
    expect(screen.queryByTestId('stock-dialog')).toBeNull();
    expect(within(screen.getByTestId('stock-notice')).getByText('Stock of “Iced Tea” updated: 26 → 50.')).toBeOnTheScreen();
  });

  it('Remove sends a negative qty_delta; Count sends counted_qty; each adjustment gets a new ULID after a 201', async () => {
    const { calls } = routeFetch([
      categoriesRoute,
      productRoute,
      adjustRoute((call) => {
        const body = jsonBody(call) as { qty_delta?: number; counted_qty?: number };
        return mockResponse(
          201,
          { data: body.counted_qty !== undefined ? makeStockMovement({ qty_delta: -4, qty_before: 20, qty_after: 16 }) : makeStockMovement({ qty_delta: -6, qty_before: 26, qty_after: 20 }) },
        );
      }),
    ]);
    await renderEdit();

    await adjust('remove', '6', 'Spilled');
    await waitFor(() => expect(screen.getByTestId('stock-on-hand')).toHaveTextContent('20'));
    await adjust('count', '16', 'Weekly count');
    await waitFor(() => expect(screen.getByTestId('stock-on-hand')).toHaveTextContent('16'));

    const [remove, count] = adjustCalls(calls);
    expect(jsonBody(remove)).toMatchObject({ qty_delta: -6, reason: 'Spilled' });
    expect(jsonBody(remove)).not.toHaveProperty('counted_qty');
    expect(jsonBody(count)).toMatchObject({ counted_qty: 16, reason: 'Weekly count' });
    expect(jsonBody(count)).not.toHaveProperty('qty_delta');
    expect(keyOf(count)).not.toBe(keyOf(remove));
  });

  it('shows 422s under their fields (below zero, already at the count, reason)', async () => {
    let reply: 'below' | 'same' | 'reason' = 'below';
    routeFetch([
      categoriesRoute,
      productRoute,
      adjustRoute(() => {
        if (reply === 'below') {
          return mockResponse(422, {
            message: "Stock can't go below zero (26 on hand).",
            errors: { qty_delta: ["Stock can't go below zero (26 on hand)."] },
          });
        }
        if (reply === 'same') {
          return mockResponse(422, { message: 'Stock is already 26.', errors: { counted_qty: ['Stock is already 26.'] } });
        }
        return mockResponse(422, {
          message: 'The reason field must not be greater than 255 characters.',
          errors: { reason: ['The reason field must not be greater than 255 characters.'] },
        });
      }),
    ]);
    await renderEdit();

    await adjust('remove', '30', 'Broken bottles');
    expect(await screen.findByTestId('stock-qty-error')).toHaveTextContent("Stock can't go below zero (26 on hand).");

    reply = 'same';
    await fireEvent.press(screen.getByTestId('stock-mode-count'));
    await fireEvent.changeText(screen.getByTestId('stock-qty'), '26');
    await fireEvent.press(screen.getByTestId('stock-dialog-confirm'));
    expect(await screen.findByTestId('stock-qty-error')).toHaveTextContent('Stock is already 26.');

    reply = 'reason';
    await fireEvent.changeText(screen.getByTestId('stock-qty'), '20');
    await fireEvent.press(screen.getByTestId('stock-dialog-confirm'));
    expect(await screen.findByTestId('stock-reason-error')).toHaveTextContent(
      'The reason field must not be greater than 255 characters.',
    );
    expect(screen.getByTestId('stock-on-hand')).toHaveTextContent('26');
  });

  it('checks the fields before sending: a whole quantity and a reason', async () => {
    const { calls } = routeFetch([categoriesRoute, productRoute]);
    await renderEdit();

    await adjust('add', '0', '   ');
    expect(screen.getByTestId('stock-qty-error')).toHaveTextContent('Enter a whole number from 1 to 100,000.');
    expect(screen.getByTestId('stock-reason-error')).toHaveTextContent('Enter a reason.');
    expect(adjustCalls(calls)).toHaveLength(0);
  });

  it('retries with the same ULID after a network error, and shows a 409 (not tracking stock) in the dialog', async () => {
    let reply: 'network' | 'conflict' = 'network';
    const { calls } = routeFetch([
      categoriesRoute,
      productRoute,
      adjustRoute(() =>
        reply === 'network'
          ? Promise.reject(new TypeError('Network request failed'))
          : mockResponse(409, { message: "This product doesn't track stock." }),
      ),
    ]);
    await renderEdit();

    await adjust('add', '5', 'Delivery');
    expect(within(await screen.findByTestId('stock-dialog-error')).getByText("We couldn't confirm the adjustment. Retry.")).toBeOnTheScreen();

    reply = 'conflict';
    await fireEvent.press(screen.getByTestId('stock-dialog-confirm'));
    await waitFor(() => expect(adjustCalls(calls)).toHaveLength(2));
    expect(within(await screen.findByTestId('stock-dialog-error')).getByText("This product doesn't track stock.")).toBeOnTheScreen();
    const [first, retry] = adjustCalls(calls);
    expect(keyOf(retry)).toBe(keyOf(first));
    expect(jsonBody(retry)).toEqual(jsonBody(first));
  });

  it('hides "Adjust stock" without inventory.adjust, but still shows the quantity', async () => {
    useSessionStore.getState().setSignedIn(
      { ...managerUser, permissions: managerUser.permissions.filter((slug) => slug !== 'inventory.adjust') },
      FUTURE,
    );
    routeFetch([categoriesRoute, productRoute]);
    await renderEdit();

    expect(screen.getByTestId('stock-on-hand')).toHaveTextContent('26');
    expect(screen.queryByTestId('stock-adjust')).toBeNull();
  });

  it('shows no stock card for a product that does not track stock', async () => {
    routeFetch([categoriesRoute, { method: 'GET', path: '/api/v1/admin/products/9', reply: () => mockResponse(200, { data: makeProduct({ id: 9 }) }) }]);
    const { client } = await renderWithQuery(<EditProductScreen />);
    await screen.findByTestId('product-form-screen');
    await waitFor(() => expect(client.isFetching()).toBe(0));

    expect(screen.queryByTestId('stock-card')).toBeNull();
  });
});
