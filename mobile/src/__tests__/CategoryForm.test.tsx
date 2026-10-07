import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import AdminCategoriesScreen from '@/app/(app)/(admin)/menu/categories/index';
import EditCategoryScreen from '@/app/(app)/(admin)/menu/categories/[id]';
import NewCategoryScreen from '@/app/(app)/(admin)/menu/categories/new';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, makeCategory, managerUser, page, renderWithQuery, routeFetch } from '@/test-utils/catalog';

const FUTURE = '2026-09-25T01:30:00Z';
const CONFLICT = 'This category still has products. Move or delete them first.';

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.back as jest.Mock).mockClear();
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '2' });
});

describe('Category form', () => {
  it('shows the 409 message in the banner when deleting a category that still has products', async () => {
    const { calls } = routeFetch([
      { method: 'GET', path: '/api/v1/admin/categories/2', reply: () => mockResponse(200, { data: makeCategory() }) },
      { method: 'DELETE', path: '/api/v1/admin/categories/2', reply: () => mockResponse(409, { message: CONFLICT }) },
    ]);

    await renderWithQuery(<EditCategoryScreen />);
    await fireEvent.press(await screen.findByTestId('category-delete'));
    expect(screen.getByTestId('delete-category-dialog')).toHaveTextContent(/still has 3 items/);

    await fireEvent.press(screen.getByTestId('delete-category-dialog-confirm'));

    expect(within(await screen.findByTestId('form-banner')).getByText(CONFLICT)).toBeOnTheScreen();
    expect(screen.queryByTestId('delete-category-dialog')).toBeNull();
    // Still on the form (no crash, no navigation), and the request really was a DELETE.
    expect(screen.getByTestId('category-name').props.value).toBe('Breakfast');
    expect(router.back).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
      '/api/v1/admin/categories/2',
    ]);
  });

  it('deletes an empty category and goes back', async () => {
    routeFetch([
      {
        method: 'GET',
        path: '/api/v1/admin/categories/2',
        reply: () => mockResponse(200, { data: makeCategory({ products_count: 0 }) }),
      },
      { method: 'DELETE', path: '/api/v1/admin/categories/2', reply: () => mockResponse(204) },
    ]);

    await renderWithQuery(<EditCategoryScreen />);
    await fireEvent.press(await screen.findByTestId('category-delete'));
    await fireEvent.press(screen.getByTestId('delete-category-dialog-confirm'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('creates a category and shows 422 name errors under the field', async () => {
    let attempt = 0;
    const { calls } = routeFetch([
      {
        method: 'POST',
        path: '/api/v1/admin/categories',
        reply: () => {
          attempt += 1;
          return attempt === 1
            ? mockResponse(422, { message: 'The name has already been taken.', errors: { name: ['The name has already been taken.'] } })
            : mockResponse(201, { data: makeCategory({ id: 5, name: 'Snacks', description: null, sort_order: 40 }) });
        },
      },
    ]);

    await renderWithQuery(<NewCategoryScreen />);
    await fireEvent.changeText(screen.getByTestId('category-name'), 'Breakfast');
    await fireEvent.changeText(screen.getByTestId('category-sort-order'), '40');
    await fireEvent.press(screen.getByTestId('category-save'));
    expect(await screen.findByTestId('category-name-error')).toHaveTextContent('The name has already been taken.');

    await fireEvent.changeText(screen.getByTestId('category-name'), 'Snacks');
    await fireEvent.press(screen.getByTestId('category-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());

    expect(jsonBody(calls[calls.length - 1])).toEqual({ name: 'Snacks', description: null, sort_order: 40, is_active: true });
  });
});

describe('Categories list', () => {
  it('renders category cards: image, name, item count, status pill and sort order', async () => {
    routeFetch([
      {
        method: 'GET',
        path: '/api/v1/admin/categories',
        reply: () =>
          mockResponse(
            200,
            page(
              [makeCategory(), makeCategory({ id: 4, name: 'Desserts', is_active: false, products_count: 1, image_url: null })],
              null,
              '/api/v1/admin/categories',
            ),
          ),
      },
    ]);

    await renderWithQuery(<AdminCategoriesScreen />);

    const breakfast = await screen.findByTestId('category-card-2');
    expect(breakfast).toHaveTextContent(/Breakfast/);
    expect(breakfast).toHaveTextContent(/Sort 10/);
    expect(screen.getByTestId('category-card-2-count')).toHaveTextContent('3 items');
    expect(screen.getByTestId('category-card-2-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('category-card-4-count')).toHaveTextContent('1 item');
    expect(screen.getByTestId('category-card-4-status')).toHaveTextContent('Inactive');
  });

  it('shows the empty state', async () => {
    routeFetch([
      { method: 'GET', path: '/api/v1/admin/categories', reply: () => mockResponse(200, page([], null, '/api/v1/admin/categories')) },
    ]);

    await renderWithQuery(<AdminCategoriesScreen />);

    expect(await screen.findByTestId('categories-grid-empty')).toHaveTextContent(/No categories yet/);
  });
});
