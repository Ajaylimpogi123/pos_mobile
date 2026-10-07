import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import AdminProductsScreen from '@/app/(app)/(admin)/menu/products/index';
import { useSessionStore } from '@/stores/session';
import { mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import {
  deferred,
  jsonBody,
  makeCategory,
  makeProduct,
  managerUser,
  page,
  renderWithQuery,
  routeFetch,
  type Route,
} from '@/test-utils/catalog';

const FUTURE = '2026-09-25T01:30:00Z';

const egg = makeProduct();
const hotDog = makeProduct({
  id: 8,
  sku: 'BRK-002',
  name: 'Hot Dog',
  description: null,
  price_cents: 8000,
  cost_cents: 3600,
  sort_order: 1,
  image_url: 'http://192.168.1.7:8000/storage/products/8/a1b2c3.webp',
  image_path: 'products/8/a1b2c3.webp',
});
const chicken = makeProduct({
  id: 9,
  category: { id: 3, name: 'Meals' },
  sku: 'MEA-001',
  name: 'Fried Chicken',
  price_cents: 10000,
  cost_cents: 4500,
  is_available: false,
});

const categoriesRoute: Route = {
  method: 'GET',
  path: '/api/v1/admin/categories',
  reply: () =>
    mockResponse(200, page([makeCategory(), makeCategory({ id: 3, name: 'Meals', sort_order: 20 })], null, '/api/v1/admin/categories')),
};

type Node = { props: Record<string, unknown>; parent: Node | null };

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

/** Cards in the grid row holding the first card (1 when there is no row wrapper). */
function renderedColumns(firstCardTestId: string): number {
  let node = (screen.getByTestId(firstCardTestId) as unknown as Node).parent;
  while (node && node.props.testID !== 'products-grid') {
    if (flattenStyle(node.props.style).flexDirection === 'row') {
      return within(node as unknown as Parameters<typeof within>[0]).getAllByTestId(/^product-card-\d+$/).length;
    }
    node = node.parent;
  }
  return 1;
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.push as jest.Mock).mockClear();
});

afterEach(() => {
  resetWindowSize();
});

describe('AdminProductsScreen', () => {
  it('renders product cards from the admin list (name, category, price, cost, image placeholder, unavailable pill)', async () => {
    const { calls } = routeFetch([
      categoriesRoute,
      { method: 'GET', path: '/api/v1/admin/products', reply: () => mockResponse(200, page([egg, hotDog, chicken])) },
    ]);

    await renderWithQuery(<AdminProductsScreen />);

    const eggCard = await screen.findByTestId('product-card-7');
    expect(eggCard).toHaveTextContent(/Egg with Rice/);
    expect(eggCard).toHaveTextContent(/Breakfast/);
    expect(screen.getByTestId('product-card-7-price')).toHaveTextContent('₱50.00');
    expect(screen.getByTestId('product-card-7-cost')).toHaveTextContent('Cost ₱22.00');
    // image_url null → placeholder; a real URL → an image.
    expect(screen.getByTestId('product-card-7-thumb-placeholder')).toBeOnTheScreen();
    expect(screen.getByTestId('product-card-8-thumb-image')).toBeOnTheScreen();
    expect(screen.getByTestId('product-card-8-price')).toHaveTextContent('₱80.00');
    expect(screen.queryByTestId('product-card-7-unavailable')).toBeNull();
    expect(screen.getByTestId('product-card-9-unavailable')).toHaveTextContent('Unavailable');

    // Category chips come from the admin categories list.
    expect(await screen.findByTestId('category-chip-3')).toHaveTextContent('Meals');

    const listCall = calls.find((call) => call.path === '/api/v1/admin/products');
    expect(listCall?.query.get('per_page')).toBe('25');
    expect(listCall?.query.has('cursor')).toBe(false);
    expect(listCall?.query.has('is_available')).toBe(false);
  });

  it('loads the next page with meta.next_cursor when the end is reached', async () => {
    const { calls } = routeFetch([
      categoriesRoute,
      {
        method: 'GET',
        path: '/api/v1/admin/products',
        reply: (call) =>
          mockResponse(200, call.query.get('cursor') === 'CUR2' ? page([chicken]) : page([egg, hotDog], 'CUR2')),
      },
    ]);

    await renderWithQuery(<AdminProductsScreen />);
    await screen.findByTestId('product-card-7');

    await act(async () => {
      fireEvent(screen.getByTestId('products-grid'), 'onEndReached');
    });

    expect(await screen.findByTestId('product-card-9')).toBeOnTheScreen();
    const cursors = calls.filter((call) => call.path === '/api/v1/admin/products').map((call) => call.query.get('cursor'));
    expect(cursors).toEqual([null, 'CUR2']);
  });

  it('sends the filters: debounced search, category and availability (as 1/0)', async () => {
    const { calls } = routeFetch([
      categoriesRoute,
      { method: 'GET', path: '/api/v1/admin/products', reply: () => mockResponse(200, page([egg])) },
    ]);

    await renderWithQuery(<AdminProductsScreen />);
    await screen.findByTestId('product-card-7');

    await fireEvent.changeText(screen.getByTestId('product-search'), '  egg ');
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/v1/admin/products' && call.query.get('search') === 'egg')).toBe(true),
    );

    await fireEvent.press(await screen.findByTestId('category-chip-2'));
    await fireEvent.press(screen.getByTestId('availability-unavailable'));

    await waitFor(() => {
      const last = calls.filter((call) => call.path === '/api/v1/admin/products').at(-1);
      expect(last?.query.get('search')).toBe('egg');
      expect(last?.query.get('category_id')).toBe('2');
      expect(last?.query.get('is_available')).toBe('0');
    });
  });

  it('shows the empty state, with a Clear filters action when filters are on', async () => {
    routeFetch([
      categoriesRoute,
      { method: 'GET', path: '/api/v1/admin/products', reply: () => mockResponse(200, page([])) },
    ]);

    await renderWithQuery(<AdminProductsScreen />);

    expect(await screen.findByTestId('products-grid-empty')).toHaveTextContent(/No products yet/);

    await fireEvent.press(screen.getByTestId('availability-available'));
    expect(await screen.findByText('No matching products')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('products-grid-empty-action'));
    expect(await screen.findByText('No products yet')).toBeOnTheScreen();
  });

  it('shows an error with Retry, and recovers when Retry succeeds', async () => {
    let fail = true;
    routeFetch([
      categoriesRoute,
      {
        method: 'GET',
        path: '/api/v1/admin/products',
        reply: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, page([egg]))),
      },
    ]);

    await renderWithQuery(<AdminProductsScreen />);

    expect(await screen.findByTestId('products-grid-error')).toHaveTextContent(/Server Error\./);

    fail = false;
    await fireEvent.press(screen.getByTestId('products-grid-error-retry'));

    expect(await screen.findByTestId('product-card-7')).toBeOnTheScreen();
  });

  it('shows a 403 as "No access" with the server message', async () => {
    routeFetch([
      categoriesRoute,
      {
        method: 'GET',
        path: '/api/v1/admin/products',
        reply: () => mockResponse(403, { message: 'This action is unauthorized.' }),
      },
    ]);

    await renderWithQuery(<AdminProductsScreen />);

    const error = await screen.findByTestId('products-grid-error');
    expect(error).toHaveTextContent(/No access/);
    expect(error).toHaveTextContent(/This action is unauthorized\./);
  });

  it('toggles availability optimistically and sends PATCH { is_available } only', async () => {
    const patch = deferred<Response>();
    // The "server": the list reflects the PATCH once it has been applied.
    let serverEgg = egg;
    const { calls } = routeFetch([
      categoriesRoute,
      { method: 'GET', path: '/api/v1/admin/products', reply: () => mockResponse(200, page([serverEgg])) },
      { method: 'PATCH', path: '/api/v1/admin/products/7', reply: () => patch.promise },
    ]);

    await renderWithQuery(<AdminProductsScreen />);
    const toggle = await screen.findByTestId('product-card-7-switch');
    expect(toggle.props.value).toBe(true);

    await fireEvent(toggle, 'valueChange', false);

    // Optimistic: flipped before the server answers.
    await waitFor(() => expect(screen.getByTestId('product-card-7-switch').props.value).toBe(false));
    expect(screen.getByTestId('product-card-7-unavailable')).toBeOnTheScreen();
    const patchCall = calls.find((call) => call.method === 'PATCH');
    expect(patchCall?.path).toBe('/api/v1/admin/products/7');
    expect(jsonBody(patchCall!)).toEqual({ is_available: false });

    serverEgg = { ...egg, is_available: false };
    await act(async () => {
      patch.resolve(mockResponse(200, { data: serverEgg }));
    });
    await waitFor(() => expect(screen.getByTestId('product-card-7-switch').props.value).toBe(false));
  });

  it('rolls the switch back and explains when the PATCH fails', async () => {
    const patch = deferred<Response>();
    routeFetch([
      categoriesRoute,
      { method: 'GET', path: '/api/v1/admin/products', reply: () => mockResponse(200, page([egg])) },
      { method: 'PATCH', path: '/api/v1/admin/products/7', reply: () => patch.promise },
    ]);

    await renderWithQuery(<AdminProductsScreen />);
    await fireEvent(await screen.findByTestId('product-card-7-switch'), 'valueChange', false);
    await waitFor(() => expect(screen.getByTestId('product-card-7-switch').props.value).toBe(false));

    await act(async () => {
      patch.resolve(mockResponse(500, { message: 'Server Error.' }));
    });

    await waitFor(() => expect(screen.getByTestId('product-card-7-switch').props.value).toBe(true));
    expect(screen.queryByTestId('product-card-7-unavailable')).toBeNull();
    expect(await screen.findByTestId('toggle-error-banner')).toHaveTextContent(/Egg with Rice.*Server Error\./);
  });

  it('opens the edit form and the new-product form', async () => {
    routeFetch([
      categoriesRoute,
      { method: 'GET', path: '/api/v1/admin/products', reply: () => mockResponse(200, page([egg])) },
    ]);

    await renderWithQuery(<AdminProductsScreen />);
    await fireEvent.press(await screen.findByTestId('product-card-7-open'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/menu/products/[id]', params: { id: '7' } });

    await fireEvent.press(screen.getByTestId('menu-new'));
    expect(router.push).toHaveBeenCalledWith('/menu/products/new');
  });

  it.each([
    ['phone portrait', REFERENCE_SIZES.phonePortrait, 1],
    ['phone landscape', REFERENCE_SIZES.phoneLandscape, 2],
    ['tablet portrait', REFERENCE_SIZES.tabletPortrait, 2],
    ['tablet landscape', REFERENCE_SIZES.tabletLandscape, 3],
  ])('lays the grid out for %s with the expected columns', async (_label, size, columns) => {
    setWindowSize(size.width, size.height);
    routeFetch([
      categoriesRoute,
      { method: 'GET', path: '/api/v1/admin/products', reply: () => mockResponse(200, page([egg, hotDog, chicken])) },
    ]);

    await renderWithQuery(<AdminProductsScreen />);
    await screen.findByTestId('product-card-7');

    expect(renderedColumns('product-card-7')).toBe(columns);
  });

  it('re-flows from 2 to 3 columns on rotation and keeps the search text', async () => {
    setWindowSize(REFERENCE_SIZES.tabletPortrait.width, REFERENCE_SIZES.tabletPortrait.height);
    routeFetch([
      categoriesRoute,
      { method: 'GET', path: '/api/v1/admin/products', reply: () => mockResponse(200, page([egg, hotDog, chicken])) },
    ]);

    await renderWithQuery(<AdminProductsScreen />);
    await screen.findByTestId('product-card-7');
    await fireEvent.changeText(screen.getByTestId('product-search'), 'egg');
    expect(renderedColumns('product-card-7')).toBe(2);

    await act(async () => {
      setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);
    });

    expect(renderedColumns('product-card-7')).toBe(3);
    expect(screen.getByTestId('product-search').props.value).toBe('egg');
  });
});
