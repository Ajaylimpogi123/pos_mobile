import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import StaffIndexRoute from '@/app/(app)/(admin)/staff/index';
import { useSessionStore } from '@/stores/session';
import { mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { managerUser, page, renderWithQuery, routeFetch, type Route } from '@/test-utils/catalog';
import { makeStaff, managerStaff, ownerStaff, rolesForManager } from '@/test-utils/staff';

const FUTURE = '2026-09-25T01:30:00Z';
const cashier = makeStaff({ has_pin: false, last_login_at: null });

const rolesRoute: Route = {
  method: 'GET',
  path: '/api/v1/admin/roles',
  reply: () => mockResponse(200, page(rolesForManager, null, '/api/v1/admin/roles')),
};

type Node = { props: Record<string, unknown>; parent: Node | null };

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

/** Cards in the grid row holding the first card (1 when there is no row wrapper). */
function renderedColumns(firstCardTestId: string): number {
  let node = (screen.getByTestId(firstCardTestId) as unknown as Node).parent;
  while (node && node.props.testID !== 'staff-grid') {
    if (flattenStyle(node.props.style).flexDirection === 'row') {
      return within(node as unknown as Parameters<typeof within>[0]).getAllByTestId(/^staff-card-\d+$/).length;
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

describe('Staff list', () => {
  it('renders cards: name, email, role chip, status, PIN status, last login ("Never" when null)', async () => {
    routeFetch([
      rolesRoute,
      { method: 'GET', path: '/api/v1/admin/users', reply: () => mockResponse(200, page([ownerStaff, managerStaff, cashier])) },
    ]);

    await renderWithQuery(<StaffIndexRoute />);

    const card = await screen.findByTestId('staff-card-3');
    expect(card).toHaveTextContent(/Carla Cashier/);
    expect(card).toHaveTextContent(/cashier@pos\.test/);
    expect(screen.getByTestId('staff-card-3-role')).toHaveTextContent(/Cashier$/);
    expect(screen.getByTestId('staff-card-3-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('staff-card-3-pin')).toHaveTextContent(/No PIN$/);
    expect(screen.getByTestId('staff-card-3-last-login')).toHaveTextContent('Last login: Never');
    expect(screen.getByTestId('staff-card-2-pin')).toHaveTextContent(/PIN set$/);
    // A real timestamp is formatted (relative or a short date), never shown raw.
    expect(screen.getByTestId('staff-card-2-last-login')).not.toHaveTextContent(/2026-09-24T/);
  });

  it('shows the "You" badge on the signed-in user\'s own record only', async () => {
    routeFetch([
      rolesRoute,
      { method: 'GET', path: '/api/v1/admin/users', reply: () => mockResponse(200, page([ownerStaff, managerStaff, cashier])) },
    ]);

    await renderWithQuery(<StaffIndexRoute />);
    await screen.findByTestId('staff-card-2');

    expect(screen.getByTestId('staff-card-2-you')).toHaveTextContent(/You$/);
    expect(screen.queryByTestId('staff-card-1-you')).toBeNull();
    expect(screen.queryByTestId('staff-card-3-you')).toBeNull();
  });

  it('locks a can_manage=false card: lock icon, no edit affordance, opens the read-only view', async () => {
    routeFetch([
      rolesRoute,
      { method: 'GET', path: '/api/v1/admin/users', reply: () => mockResponse(200, page([ownerStaff, cashier])) },
    ]);

    await renderWithQuery(<StaffIndexRoute />);
    await screen.findByTestId('staff-card-1');

    expect(screen.getByTestId('staff-card-1-locked')).toBeOnTheScreen();
    expect(screen.queryByTestId('staff-card-1-edit')).toBeNull();
    expect(screen.getByTestId('staff-card-1-open').props.accessibilityHint).toMatch(/view only/);
    // A manageable card has the edit affordance and no lock.
    expect(screen.getByTestId('staff-card-3-edit')).toBeOnTheScreen();
    expect(screen.queryByTestId('staff-card-3-locked')).toBeNull();

    await fireEvent.press(screen.getByTestId('staff-card-3-open'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/staff/[id]', params: { id: '3' } });
  });

  it('builds the query from the filters: debounced search, role chip and Active / Inactive', async () => {
    const { calls } = routeFetch([
      rolesRoute,
      { method: 'GET', path: '/api/v1/admin/users', reply: () => mockResponse(200, page([cashier])) },
    ]);

    await renderWithQuery(<StaffIndexRoute />);
    await screen.findByTestId('staff-card-3');

    const first = calls.find((call) => call.path === '/api/v1/admin/users');
    expect(first?.query.get('per_page')).toBe('25');
    expect(first?.query.has('is_active')).toBe(false);
    expect(first?.query.has('role_id')).toBe(false);

    // Role chips come from GET /admin/roles (all roles, for filtering).
    expect(await screen.findByTestId('role-chip-1')).toHaveTextContent(/Owner$/);

    await fireEvent.changeText(screen.getByTestId('staff-search'), ' carla ');
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/v1/admin/users' && call.query.get('search') === 'carla')).toBe(true),
    );

    await fireEvent.press(screen.getByTestId('role-chip-3'));
    await fireEvent.press(screen.getByTestId('staff-status-inactive'));

    await waitFor(() => {
      const last = calls.filter((call) => call.path === '/api/v1/admin/users').at(-1);
      expect(last?.query.get('search')).toBe('carla');
      expect(last?.query.get('role_id')).toBe('3');
      expect(last?.query.get('is_active')).toBe('0');
    });

    await fireEvent.press(screen.getByTestId('staff-status-active'));
    await waitFor(() => {
      const last = calls.filter((call) => call.path === '/api/v1/admin/users').at(-1);
      expect(last?.query.get('is_active')).toBe('1');
    });
  });

  it('shows a 403 from the API as "No access"', async () => {
    routeFetch([
      rolesRoute,
      { method: 'GET', path: '/api/v1/admin/users', reply: () => mockResponse(403, { message: 'This action is unauthorized.' }) },
    ]);

    await renderWithQuery(<StaffIndexRoute />);

    const error = await screen.findByTestId('staff-grid-error');
    expect(error).toHaveTextContent(/No access/);
    expect(error).toHaveTextContent(/This action is unauthorized\./);
  });

  it('shows the empty state and opens "New staff"', async () => {
    routeFetch([
      rolesRoute,
      { method: 'GET', path: '/api/v1/admin/users', reply: () => mockResponse(200, page([])) },
    ]);

    await renderWithQuery(<StaffIndexRoute />);

    expect(await screen.findByTestId('staff-grid-empty')).toHaveTextContent(/No staff yet/);
    await fireEvent.press(screen.getByTestId('staff-new'));
    expect(router.push).toHaveBeenCalledWith('/staff/new');
  });

  it('loads the next page with meta.next_cursor', async () => {
    const { calls } = routeFetch([
      rolesRoute,
      {
        method: 'GET',
        path: '/api/v1/admin/users',
        reply: (call) =>
          mockResponse(200, call.query.get('cursor') === 'CUR2' ? page([cashier]) : page([ownerStaff, managerStaff], 'CUR2')),
      },
    ]);

    await renderWithQuery(<StaffIndexRoute />);
    await screen.findByTestId('staff-card-1');

    await act(async () => {
      fireEvent(screen.getByTestId('staff-grid'), 'onEndReached');
    });

    expect(await screen.findByTestId('staff-card-3')).toBeOnTheScreen();
    expect(calls.filter((call) => call.path === '/api/v1/admin/users').map((call) => call.query.get('cursor'))).toEqual([
      null,
      'CUR2',
    ]);
  });

  it.each([
    ['phone portrait', REFERENCE_SIZES.phonePortrait, 1],
    ['phone landscape', REFERENCE_SIZES.phoneLandscape, 2],
    ['tablet portrait', REFERENCE_SIZES.tabletPortrait, 2],
  ])('lays the grid out for %s with the expected columns', async (_label, size, columns) => {
    setWindowSize(size.width, size.height);
    routeFetch([
      rolesRoute,
      { method: 'GET', path: '/api/v1/admin/users', reply: () => mockResponse(200, page([ownerStaff, managerStaff, cashier])) },
    ]);

    await renderWithQuery(<StaffIndexRoute />);
    await screen.findByTestId('staff-card-1');

    expect(renderedColumns('staff-card-1')).toBe(columns);
  });

  it('tablet landscape: the data table (MASTER §6), with the same row names', async () => {
    setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);
    routeFetch([
      rolesRoute,
      { method: 'GET', path: '/api/v1/admin/users', reply: () => mockResponse(200, page([ownerStaff, managerStaff, cashier])) },
    ]);

    await renderWithQuery(<StaffIndexRoute />);
    await screen.findByTestId('staff-card-1');

    expect(screen.getByTestId('staff-grid-header')).toHaveTextContent(/Name.*Role.*Status.*PIN.*Last login/);
    expect(screen.getByTestId('staff-grid-more-count')).toHaveTextContent('Showing 3');
  });
});
