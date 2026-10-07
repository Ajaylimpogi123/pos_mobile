import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import StaffMemberRoute from '@/app/(app)/(admin)/staff/[id]';
import NewStaffRoute from '@/app/(app)/(admin)/staff/new';
import { useSessionStore } from '@/stores/session';
import { mockResponse, REFERENCE_SIZES, resetWindowSize, secureStoreMock, setWindowSize } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type Route } from '@/test-utils/catalog';
import { makeStaff, managerStaff, ownerStaff, rolesForManager } from '@/test-utils/staff';

const FUTURE = '2026-09-25T01:30:00Z';
const POLICY_422 = {
  message: 'The password field must contain at least one uppercase and one lowercase letter. (and 1 more error)',
  errors: {
    password: [
      'The password field must contain at least one uppercase and one lowercase letter.',
      'The password field must contain at least one number.',
    ],
  },
};

const rolesRoute: Route = {
  method: 'GET',
  path: '/api/v1/admin/roles',
  reply: () => mockResponse(200, page(rolesForManager, null, '/api/v1/admin/roles')),
};

function showRoute(user = makeStaff()): Route {
  return { method: 'GET', path: `/api/v1/admin/users/${user.id}`, reply: () => mockResponse(200, { data: user }) };
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.back as jest.Mock).mockClear();
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '3' });
});

afterEach(() => {
  resetWindowSize();
});

type Node = { props: Record<string, unknown>; parent: Node | null };

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

/** flexDirection of the nearest ancestor that lays the security card out beside / below the details. */
function panesDirection(): unknown {
  let node = (screen.getByTestId('staff-security-card') as unknown as Node).parent;
  while (node) {
    const direction = flattenStyle(node.props.style).flexDirection;
    if (direction === 'row' || direction === 'column') return direction;
    node = node.parent;
  }
  return null;
}

describe('Staff create', () => {
  it('lists only assignable roles in the role picker', async () => {
    routeFetch([rolesRoute]);

    await renderWithQuery(<NewStaffRoute />);

    expect(await screen.findByTestId('role-option-2')).toHaveTextContent(/Manager$/);
    expect(screen.getByTestId('role-option-3')).toHaveTextContent(/Cashier$/);
    // Owner is not assignable by a manager: not offered at all.
    expect(screen.queryByTestId('role-option-1')).toBeNull();
    expect(screen.getByTestId('staff-password-policy')).toHaveTextContent(/10 characters.*upper- and lowercase.*number/);
  });

  it('shows a 422 password-policy error under the password field, then creates with the right body', async () => {
    let attempt = 0;
    const { calls } = routeFetch([
      rolesRoute,
      {
        method: 'POST',
        path: '/api/v1/admin/users',
        reply: () => {
          attempt += 1;
          return attempt === 1
            ? mockResponse(422, POLICY_422)
            : mockResponse(201, { data: makeStaff({ id: 7, name: 'Nina New', email: 'nina@pos.test', has_pin: true }) });
        },
      },
    ]);

    await renderWithQuery(<NewStaffRoute />);
    await fireEvent.changeText(screen.getByTestId('staff-name'), ' Nina New ');
    await fireEvent.changeText(screen.getByTestId('staff-email'), 'nina@pos.test');
    // Passes the local length check; the server's policy is the real check.
    await fireEvent.changeText(screen.getByTestId('staff-password'), 'Abcdefghij1');
    await fireEvent.press(await screen.findByTestId('role-option-3'));
    await fireEvent.changeText(screen.getByTestId('staff-pin'), '0580');
    await fireEvent.press(screen.getByTestId('staff-save'));

    expect(await screen.findByTestId('staff-password-error')).toHaveTextContent(
      'The password field must contain at least one uppercase and one lowercase letter.',
    );
    expect(screen.queryByTestId('form-banner')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('staff-password'), 'Abcdefghij2');
    expect(screen.queryByTestId('staff-password-error')).toBeNull();
    await fireEvent.press(screen.getByTestId('staff-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());

    const posts = calls.filter((call) => call.method === 'POST');
    expect(jsonBody(posts.at(-1)!)).toEqual({
      name: 'Nina New',
      email: 'nina@pos.test',
      password: 'Abcdefghij2',
      role_id: 3,
      is_active: true,
      pin: '0580',
    });
  });

  it('checks the password policy and the PIN format locally before sending', async () => {
    const { calls } = routeFetch([rolesRoute]);

    await renderWithQuery(<NewStaffRoute />);
    await fireEvent.changeText(screen.getByTestId('staff-name'), 'Nina');
    await fireEvent.changeText(screen.getByTestId('staff-email'), 'nina@pos.test');
    await fireEvent.changeText(screen.getByTestId('staff-password'), 'short');
    await fireEvent.changeText(screen.getByTestId('staff-pin'), '12');
    await fireEvent.press(screen.getByTestId('staff-save'));

    expect(screen.getByTestId('staff-password-error')).toHaveTextContent('Use at least 10 characters.');
    expect(screen.getByTestId('staff-pin-error')).toHaveTextContent('Enter 4 to 6 digits.');
    expect(screen.getByTestId('role-picker-error')).toHaveTextContent('Choose a role.');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('toggles the password visibility', async () => {
    routeFetch([rolesRoute]);

    await renderWithQuery(<NewStaffRoute />);
    expect(screen.getByTestId('staff-password').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByTestId('staff-password-toggle'));
    expect(screen.getByTestId('staff-password').props.secureTextEntry).toBe(false);
  });
});

describe('Staff edit', () => {
  it('disables the role and Active controls on your own record, and hides Delete', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '2' });
    routeFetch([rolesRoute, showRoute(managerStaff)]);

    await renderWithQuery(<StaffMemberRoute />);

    expect(await screen.findByTestId('staff-self-chip')).toBeOnTheScreen();
    expect(screen.getByTestId('staff-active').props.disabled).toBe(true);
    expect(screen.getByTestId('role-picker-hint')).toHaveTextContent("You can't change your own role.");
    const managerChip = await screen.findByTestId('role-option-2');
    expect(managerChip.props.accessibilityState).toMatchObject({ selected: true, disabled: true });
    expect(screen.getByTestId('role-option-3').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.queryByTestId('staff-delete')).toBeNull();
    expect(screen.getByTestId('staff-delete-self-hint')).toBeOnTheScreen();
    // No password or PIN inputs in the edit form itself.
    expect(screen.queryByTestId('staff-password')).toBeNull();
    expect(screen.queryByTestId('staff-pin')).toBeNull();
  });

  it('updates the session user when you edit your own name', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '2' });
    const { calls } = routeFetch([
      rolesRoute,
      showRoute(managerStaff),
      {
        method: 'PATCH',
        path: '/api/v1/admin/users/2',
        reply: () => mockResponse(200, { data: { ...managerStaff, name: 'Mia M. Manager' } }),
      },
    ]);

    await renderWithQuery(<StaffMemberRoute />);
    await fireEvent.changeText(await screen.findByTestId('staff-name'), 'Mia M. Manager');
    await fireEvent.press(screen.getByTestId('staff-save'));

    await waitFor(() => expect(useSessionStore.getState().user?.name).toBe('Mia M. Manager'));
    // Only the changed field; never role_id / is_active on your own record.
    expect(jsonBody(calls.find((call) => call.method === 'PATCH')!)).toEqual({ name: 'Mia M. Manager' });
    expect(router.back).toHaveBeenCalled();
  });

  it('shows a 409 from deactivating in the banner', async () => {
    const message = 'You cannot deactivate your own account.';
    routeFetch([
      rolesRoute,
      showRoute(),
      { method: 'PATCH', path: '/api/v1/admin/users/3', reply: () => mockResponse(409, { message }) },
    ]);

    await renderWithQuery(<StaffMemberRoute />);
    await fireEvent(await screen.findByTestId('staff-active'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('staff-save'));

    expect(within(await screen.findByTestId('form-banner')).getByText(message)).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('shows a 409 from delete in the banner (dialog closed, still on the form)', async () => {
    const message = 'You cannot delete your own account.';
    const { calls } = routeFetch([
      rolesRoute,
      showRoute(),
      { method: 'DELETE', path: '/api/v1/admin/users/3', reply: () => mockResponse(409, { message }) },
    ]);

    await renderWithQuery(<StaffMemberRoute />);
    await fireEvent.press(await screen.findByTestId('staff-delete'));
    await fireEvent.press(screen.getByTestId('delete-staff-dialog-confirm'));

    expect(within(await screen.findByTestId('form-banner')).getByText(message)).toBeOnTheScreen();
    expect(screen.queryByTestId('delete-staff-dialog')).toBeNull();
    expect(screen.getByTestId('staff-name').props.value).toBe('Carla Cashier');
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual(['/api/v1/admin/users/3']);
  });

  it('opens a can_manage=false user as a read-only view', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '1' });
    routeFetch([rolesRoute, showRoute(ownerStaff)]);

    await renderWithQuery(<StaffMemberRoute />);

    expect(await screen.findByTestId('staff-readonly-screen')).toHaveTextContent(/Olga Owner/);
    expect(screen.getByTestId('staff-readonly-banner')).toBeOnTheScreen();
    expect(screen.queryByTestId('staff-name')).toBeNull();
    expect(screen.queryByTestId('staff-save')).toBeNull();
    expect(screen.queryByTestId('staff-security-card')).toBeNull();
  });
});

describe('Staff edit layout', () => {
  it('puts the security card beside the form on tablet landscape and below it otherwise, keeping input on rotation', async () => {
    setWindowSize(REFERENCE_SIZES.tabletPortrait.width, REFERENCE_SIZES.tabletPortrait.height);
    routeFetch([rolesRoute, showRoute()]);

    await renderWithQuery(<StaffMemberRoute />);
    await fireEvent.changeText(await screen.findByTestId('staff-name'), 'Carla C.');
    expect(panesDirection()).toBe('column');

    await act(async () => {
      setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);
    });
    expect(panesDirection()).toBe('row');
    expect(screen.getByTestId('staff-name').props.value).toBe('Carla C.');

    await act(async () => {
      setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height);
    });
    expect(panesDirection()).toBe('column');
    expect(screen.getByTestId('staff-name').props.value).toBe('Carla C.');
  });
});

describe('Reset password dialog', () => {
  it('POSTs the new password and shows a success banner', async () => {
    const { calls } = routeFetch([
      rolesRoute,
      showRoute(),
      { method: 'POST', path: '/api/v1/admin/users/3/password', reply: () => mockResponse(204) },
    ]);

    await renderWithQuery(<StaffMemberRoute />);
    await fireEvent.press(await screen.findByTestId('staff-reset-password'));
    await fireEvent.changeText(screen.getByTestId('password-dialog-input'), 'BrandNew2026');
    await fireEvent.press(screen.getByTestId('password-dialog-confirm'));

    expect(await screen.findByTestId('form-notice')).toHaveTextContent(/Password reset\. Carla Cashier was signed out/);
    expect(screen.queryByTestId('password-dialog')).toBeNull();
    const post = calls.find((call) => call.path === '/api/v1/admin/users/3/password');
    expect(post?.method).toBe('POST');
    expect(jsonBody(post!)).toEqual({ password: 'BrandNew2026' });
  });

  it('notes that your other devices were signed out when it is your own account', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '2' });
    routeFetch([
      rolesRoute,
      showRoute(managerStaff),
      { method: 'POST', path: '/api/v1/admin/users/2/password', reply: () => mockResponse(204) },
    ]);

    await renderWithQuery(<StaffMemberRoute />);
    await fireEvent.press(await screen.findByTestId('staff-reset-password'));
    await fireEvent.changeText(screen.getByTestId('password-dialog-input'), 'BrandNew2026');
    await fireEvent.press(screen.getByTestId('password-dialog-confirm'));

    expect(await screen.findByTestId('form-notice')).toHaveTextContent(/other devices were signed out/);
    // Still signed in on this device.
    expect(useSessionStore.getState().status).toBe('signedIn');
  });

  it('shows a 422 under the input and keeps the dialog open', async () => {
    routeFetch([
      rolesRoute,
      showRoute(),
      { method: 'POST', path: '/api/v1/admin/users/3/password', reply: () => mockResponse(422, POLICY_422) },
    ]);

    await renderWithQuery(<StaffMemberRoute />);
    await fireEvent.press(await screen.findByTestId('staff-reset-password'));
    await fireEvent.changeText(screen.getByTestId('password-dialog-input'), 'abcdefghijk');
    // Local check first: no uppercase / number.
    await fireEvent.press(screen.getByTestId('password-dialog-confirm'));
    expect(screen.getByTestId('password-dialog-input-error')).toHaveTextContent('Use both upper- and lowercase letters.');

    await fireEvent.changeText(screen.getByTestId('password-dialog-input'), 'Abcdefghijk1');
    await fireEvent.press(screen.getByTestId('password-dialog-confirm'));
    expect(await screen.findByTestId('password-dialog-input-error')).toHaveTextContent(
      'The password field must contain at least one uppercase and one lowercase letter.',
    );
    expect(screen.getByTestId('password-dialog')).toBeOnTheScreen();
  });
});

describe('PIN dialog', () => {
  it('validates 4–6 digits locally, sends the PIN as a string, and updates the PIN status', async () => {
    const { calls } = routeFetch([
      rolesRoute,
      showRoute(),
      { method: 'PUT', path: '/api/v1/admin/users/3/pin', reply: () => mockResponse(200, { data: makeStaff({ has_pin: true }) }) },
    ]);

    await renderWithQuery(<StaffMemberRoute />);
    expect(await screen.findByTestId('staff-pin-status')).toHaveTextContent(/No PIN$/);
    await fireEvent.press(screen.getByTestId('staff-set-pin'));

    await fireEvent.changeText(screen.getByTestId('pin-dialog-input'), '12');
    await fireEvent.press(screen.getByTestId('pin-dialog-confirm'));
    expect(screen.getByTestId('pin-dialog-input-error')).toHaveTextContent('Enter 4 to 6 digits.');
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);

    // Non-digits are dropped as you type.
    await fireEvent.changeText(screen.getByTestId('pin-dialog-input'), '05a80');
    expect(screen.getByTestId('pin-dialog-input').props.value).toBe('0580');
    await fireEvent.press(screen.getByTestId('pin-dialog-confirm'));

    expect(await screen.findByTestId('form-notice')).toHaveTextContent(/PIN set\.$/);
    const put = calls.find((call) => call.method === 'PUT');
    expect(String(put?.init.body)).toBe('{"pin":"0580"}');
    expect(screen.getByTestId('staff-pin-status')).toHaveTextContent(/PIN set$/);
    expect(screen.getByTestId('staff-set-pin')).toHaveTextContent(/Change PIN/);
  });

  it("shows the server's 422 message for a trivial PIN under the input", async () => {
    const message = 'The PIN is too easy to guess.';
    routeFetch([
      rolesRoute,
      showRoute(),
      { method: 'PUT', path: '/api/v1/admin/users/3/pin', reply: () => mockResponse(422, { message, errors: { pin: [message] } }) },
    ]);

    await renderWithQuery(<StaffMemberRoute />);
    await fireEvent.press(await screen.findByTestId('staff-set-pin'));
    await fireEvent.changeText(screen.getByTestId('pin-dialog-input'), '1234');
    await fireEvent.press(screen.getByTestId('pin-dialog-confirm'));

    expect(await screen.findByTestId('pin-dialog-input-error')).toHaveTextContent(message);
    expect(screen.getByTestId('pin-dialog')).toBeOnTheScreen();
  });

  it('removes the PIN with pin: null after a confirm', async () => {
    const withPin = makeStaff({ has_pin: true });
    const { calls } = routeFetch([
      rolesRoute,
      showRoute(withPin),
      { method: 'PUT', path: '/api/v1/admin/users/3/pin', reply: () => mockResponse(200, { data: makeStaff({ has_pin: false }) }) },
    ]);

    await renderWithQuery(<StaffMemberRoute />);
    await fireEvent.press(await screen.findByTestId('staff-remove-pin'));
    await fireEvent.press(screen.getByTestId('remove-pin-dialog-confirm'));

    expect(await screen.findByTestId('form-notice')).toHaveTextContent(/PIN removed\.$/);
    expect(String(calls.find((call) => call.method === 'PUT')?.init.body)).toBe('{"pin":null}');
    expect(screen.getByTestId('staff-pin-status')).toHaveTextContent(/No PIN$/);
    expect(screen.queryByTestId('staff-remove-pin')).toBeNull();
  });
});
