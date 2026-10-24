/**
 * PIN quick-switch (contract → Core Sale → GET /auth/pin-users, POST /auth/pin,
 * App → PIN switch): the session is swapped exactly like a login, while the
 * cart and the on-device menu are kept and user-specific queries are reset.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import SwitchUserRoute from '@/app/(app)/switch-user';
import { AppShell } from '@/components/shell/AppShell';
import { getToken, getUser, saveSession } from '@/services/secureStorage';
import type { AuthUser, LoginResponse } from '@/services/types';
import { resetCart, useCartStore } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type Route } from '@/test-utils/catalog';
import { HOT_DOG, PIN_USERS } from '@/test-utils/sale';

const FUTURE = '2099-09-25T01:30:00Z';
const OLD_TOKEN = '3|cashier-token';
const useNetworkState = jest.requireMock('expo-network').useNetworkState as jest.Mock;

const marco: AuthUser = { ...managerUser, id: 2, name: 'Marco Manager', email: 'manager@pos.test' };

const pinUsersRoute: Route = {
  method: 'GET',
  path: '/api/v1/auth/pin-users',
  reply: () => mockResponse(200, page(PIN_USERS, null, '/api/v1/auth/pin-users')),
};

function pinRoute(reply: Route['reply']): Route {
  return { method: 'POST', path: '/api/v1/auth/pin', reply };
}

function loginResponse(user: AuthUser): { data: LoginResponse } {
  return { data: { token: '7|marco-token', token_type: 'Bearer', expires_at: '2099-09-26T01:30:00Z', user } };
}

async function renderSwitch() {
  const result = await renderWithQuery(<SwitchUserRoute />);
  await screen.findByTestId('pin-users-grid');
  return result;
}

async function enterPin(pin: string) {
  for (const digit of pin) await fireEvent.press(screen.getByTestId(`switch-pin-key-${digit}`));
}

/** A message element shows exactly `message` (an icon glyph is part of the element's text content). */
function expectText(testID: string, message: string) {
  expect(within(screen.getByTestId(testID)).getByText(message)).toBeOnTheScreen();
}

beforeEach(async () => {
  secureStoreMock().__resetSecureStore();
  resetCart();
  await saveSession(OLD_TOKEN, FUTURE, cashierUser);
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  useNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'WIFI' });
  (router.navigate as jest.Mock).mockClear();
});

describe('Switch user', () => {
  it('is not offered in the sidebar (the footer has only Log out)', async () => {
    await render(
      <AppShell>
        <Text>Content</Text>
      </AppShell>,
    );

    expect(screen.getByTestId('sidebar-logout')).toBeOnTheScreen();
    expect(screen.queryByTestId('sidebar-switch-user')).toBeNull();
  });

  it('lists the people who can switch with a PIN, marking the current user', async () => {
    const { calls } = routeFetch([pinUsersRoute]);
    await renderSwitch();

    expect(calls[0].path).toBe('/api/v1/auth/pin-users');
    expect(screen.getByTestId('pin-user-2')).toHaveTextContent(/Marco Manager.*Manager/);
    expect(screen.getByTestId('pin-user-3')).toHaveTextContent(/Carla Cashier.*You/);
    expect(screen.getByTestId('pin-user-1')).not.toHaveTextContent(/You/);
  });

  it('swaps the token and the user like a login, keeps the cart, resets cached queries, and opens Sell', async () => {
    const cart = useCartStore.getState();
    cart.addProduct(HOT_DOG);
    const pendingUlid = cart.beginCheckout();
    const { calls } = routeFetch([pinUsersRoute, pinRoute(() => mockResponse(200, loginResponse(marco)))]);
    const { client } = await renderSwitch();
    client.setQueryData(['orders', 'list', { businessDate: '2026-09-25', search: '' }], { pages: [], pageParams: [] });

    await fireEvent.press(screen.getByTestId('pin-user-2-open'));
    expect(screen.getByTestId('switch-selected')).toHaveTextContent('Marco Manager');
    await enterPin('246');
    expect(screen.getByTestId('switch-submit')).toBeDisabled();
    await enterPin('8');
    await fireEvent.press(screen.getByTestId('switch-submit'));

    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('/sell'));
    const pinCall = calls.find((call) => call.path === '/api/v1/auth/pin');
    expect(jsonBody(pinCall!)).toEqual({ user_id: 2, pin: '2468' });
    expect((pinCall!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OLD_TOKEN}`);

    // The session is Marco's now, persisted exactly like a login.
    expect(await getToken()).toBe('7|marco-token');
    expect((await getUser())?.id).toBe(2);
    expect(useSessionStore.getState()).toMatchObject({ status: 'signedIn', expiresAt: '2099-09-26T01:30:00Z' });
    expect(useSessionStore.getState().user?.name).toBe('Marco Manager');

    // The cart and its pending sale stay on the device.
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().pendingUlid).toBe(pendingUlid);

    // Nothing cached for the previous user survives.
    expect(client.getQueryData(['orders', 'list', { businessDate: '2026-09-25', search: '' }])).toBeUndefined();
  });

  it('shows a wrong PIN under the pad and clears it; the session stays as it was', async () => {
    routeFetch([
      pinUsersRoute,
      pinRoute(() => mockResponse(422, { message: 'Incorrect PIN.', errors: { pin: ['Incorrect PIN.'] } })),
    ]);
    await renderSwitch();
    await fireEvent.press(screen.getByTestId('pin-user-2-open'));
    await enterPin('1357');
    await fireEvent.press(screen.getByTestId('switch-submit'));

    expect(await screen.findByTestId('switch-pin-error')).toHaveTextContent('Incorrect PIN.');
    expect(screen.getByTestId('switch-pin-dots').props.accessibilityLabel).toMatch(/0 of 4 to 6 digits/);
    expect(await getToken()).toBe(OLD_TOKEN);
    expect(useSessionStore.getState().user?.id).toBe(3);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows a locked PIN (429)', async () => {
    routeFetch([
      pinUsersRoute,
      pinRoute(() => mockResponse(429, { message: 'Too many incorrect PIN attempts. Try again in 12 minutes.' })),
    ]);
    await renderSwitch();
    await fireEvent.press(screen.getByTestId('pin-user-2-open'));
    await enterPin('2468');
    await fireEvent.press(screen.getByTestId('switch-submit'));

    expect(await screen.findByTestId('switch-pin-error')).toHaveTextContent(
      'Too many incorrect PIN attempts. Try again in 12 minutes.',
    );
  });

  it('goes back to the list with the message when the person can\'t use a PIN (422 on user_id)', async () => {
    routeFetch([
      pinUsersRoute,
      pinRoute(() =>
        mockResponse(422, {
          message: "This person can't sign in with a PIN.",
          errors: { user_id: ["This person can't sign in with a PIN."] },
        }),
      ),
    ]);
    await renderSwitch();
    await fireEvent.press(screen.getByTestId('pin-user-1-open'));
    await enterPin('2468');
    await fireEvent.press(screen.getByTestId('switch-submit'));

    await screen.findByTestId('switch-banner');
    expectText('switch-banner', "This person can't sign in with a PIN.");
    expect(screen.queryByTestId('switch-pin-step')).toBeNull();
  });

  it('"Use email instead" logs out', async () => {
    const { calls } = routeFetch([
      pinUsersRoute,
      { method: 'POST', path: '/api/v1/auth/logout', reply: () => mockResponse(204) },
    ]);
    await renderSwitch();

    await fireEvent.press(screen.getByTestId('switch-use-email'));

    await waitFor(() => expect(useSessionStore.getState().status).toBe('signedOut'));
    expect(calls.some((call) => call.method === 'POST' && call.path === '/api/v1/auth/logout')).toBe(true);
    expect(await getToken()).toBeNull();
  });

  it('needs a connection: offline shows a notice and Sign in stays disabled', async () => {
    useNetworkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'NONE' });
    routeFetch([pinUsersRoute]);
    await renderSwitch();

    expectText('switch-offline', 'Switching users needs a connection.');
    await fireEvent.press(screen.getByTestId('pin-user-2-open'));
    await enterPin('2468');
    expect(screen.getByTestId('switch-submit')).toBeDisabled();
  });

  it('shows the load error with Retry', async () => {
    let fail = true;
    routeFetch([
      {
        method: 'GET',
        path: '/api/v1/auth/pin-users',
        reply: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, page(PIN_USERS))),
      },
    ]);
    await renderWithQuery(<SwitchUserRoute />);

    expect(await screen.findByTestId('pin-users-error')).toHaveTextContent(/Server Error\./);
    fail = false;
    await fireEvent.press(screen.getByTestId('pin-users-error-retry'));
    expect(await screen.findByTestId('pin-users-grid')).toBeOnTheScreen();
  });
});
