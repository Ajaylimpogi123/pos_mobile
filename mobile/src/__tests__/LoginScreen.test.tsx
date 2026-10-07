import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import LoginScreen from '@/app/(auth)/login';
import { saveSession } from '@/services/secureStorage';
import { useSessionStore } from '@/stores/session';
import {
  cashierUser,
  flushTimers,
  installFetchMock,
  mockResponse,
  REFERENCE_SIZES,
  resetWindowSize,
  secureStoreMock,
  setWindowSize,
} from '@/test-utils';

const FUTURE = '2026-09-25T01:30:00Z';

let fetchMock: jest.Mock;

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  fetchMock = installFetchMock();
  (router.replace as jest.Mock).mockClear();
  useSessionStore.getState().setSignedOut();
});

afterEach(() => {
  resetWindowSize();
});

async function fillAndSubmit(email = 'cashier@pos.test', password = 'wrong') {
  await fireEvent.changeText(screen.getByTestId('login-email'), email);
  await fireEvent.changeText(screen.getByTestId('login-password'), password);
  await fireEvent.press(screen.getByTestId('login-submit'));
}

function lastRequestBody(): unknown {
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe('LoginScreen: form', () => {
  it('renders only email and password inputs, plus the Log in button', async () => {
    await render(<LoginScreen />);

    expect(screen.getByTestId('login-email')).toBeOnTheScreen();
    expect(screen.getByTestId('login-password')).toBeOnTheScreen();
    expect(screen.getByTestId('login-submit')).toBeOnTheScreen();
    expect(screen.queryByText(/device/i)).toBeNull();
  });

  it('sends only email and password, then signs in', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, { data: { token: '1|t', token_type: 'Bearer', expires_at: FUTURE, user: cashierUser } }),
    );

    await render(<LoginScreen />);
    await fillAndSubmit(' cashier@pos.test ', 'password');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.168.1.50:8000/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(lastRequestBody()).toEqual({ email: 'cashier@pos.test', password: 'password' });
    expect(useSessionStore.getState().status).toBe('signedIn');
  });

  it('toggles password visibility with the eye button', async () => {
    await render(<LoginScreen />);

    const toggle = screen.getByTestId('login-password-toggle');
    expect(screen.getByTestId('login-password')).toHaveProp('secureTextEntry', true);
    expect(toggle).toHaveAccessibleName('Show password');

    await fireEvent.press(toggle);

    expect(screen.getByTestId('login-password')).toHaveProp('secureTextEntry', false);
    expect(screen.getByTestId('login-password-toggle')).toHaveAccessibleName('Hide password');

    await fireEvent.press(screen.getByTestId('login-password-toggle'));
    expect(screen.getByTestId('login-password')).toHaveProp('secureTextEntry', true);
  });
});

describe('LoginScreen: errors', () => {
  it('401 shows the server message in the banner and does not clear the session or redirect', async () => {
    // An existing stored session (e.g. another user's) must survive a failed login attempt.
    await saveSession('1|existing', FUTURE, cashierUser);
    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Invalid email or password.' }));

    await render(<LoginScreen />);
    await fillAndSubmit();
    await flushTimers();

    expect(await screen.findByTestId('login-banner')).toHaveTextContent(/Invalid email or password\.$/);
    expect(screen.queryByTestId('login-email-error')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
    expect(await secureStoreMock().getItemAsync('pos.auth.token')).toBe('1|existing');
    expect(useSessionStore.getState().status).toBe('signedOut');
  });

  it('403 (deactivated) shows the server message in the banner', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(403, { message: 'This account has been deactivated.' }));

    await render(<LoginScreen />);
    await fillAndSubmit('inactive@pos.test', 'password');

    expect(await screen.findByTestId('login-banner')).toHaveTextContent(/This account has been deactivated\.$/);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('422 shows messages under the matching fields, not in the banner', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(422, {
        message: 'The email field must be a valid email address. (and 1 more error)',
        errors: {
          email: ['The email field must be a valid email address.'],
          password: ['The password field is required.'],
        },
      }),
    );

    await render(<LoginScreen />);
    await fillAndSubmit('not-an-email', '');

    expect(await screen.findByTestId('login-email-error')).toHaveTextContent(
      'The email field must be a valid email address.',
    );
    expect(screen.getByTestId('login-password-error')).toHaveTextContent('The password field is required.');
    expect(screen.queryByTestId('login-banner')).toBeNull();
  });

  it('429 shows the friendly rate-limit message in the banner', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(429, { message: 'Too Many Attempts.' }));

    await render(<LoginScreen />);
    await fillAndSubmit();

    expect(await screen.findByTestId('login-banner')).toHaveTextContent(/Too many login attempts/);
  });

  it('clears a field error when that field is edited', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(422, {
        message: 'The password field is required.',
        errors: { password: ['The password field is required.'] },
      }),
    );

    await render(<LoginScreen />);
    await fillAndSubmit('cashier@pos.test', '');
    expect(await screen.findByTestId('login-password-error')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('login-password'), 'password');

    expect(screen.queryByTestId('login-password-error')).toBeNull();
  });
});

describe('LoginScreen: responsive layout', () => {
  it.each([
    ['360×640', REFERENCE_SIZES.phonePortraitSmall],
    ['640×360', REFERENCE_SIZES.phoneLandscapeSmall],
    ['430×932', REFERENCE_SIZES.phonePortrait],
    ['932×430', REFERENCE_SIZES.phoneLandscape],
  ])('renders a single column on a phone (%s)', async (_label, size) => {
    setWindowSize(size.width, size.height);

    await render(<LoginScreen />);

    expect(screen.getByTestId('login-layout-single')).toBeOnTheScreen();
    expect(screen.getByTestId('login-brand-header')).toBeOnTheScreen();
    expect(screen.queryByTestId('login-brand-panel')).toBeNull();
    expect(screen.getByTestId('login-card')).toBeOnTheScreen();
  });

  it('renders the brand header on top on a tablet in portrait (800×1280)', async () => {
    setWindowSize(REFERENCE_SIZES.tabletPortrait.width, REFERENCE_SIZES.tabletPortrait.height);

    await render(<LoginScreen />);

    expect(screen.getByTestId('login-layout-single')).toBeOnTheScreen();
    expect(screen.getByTestId('login-brand-header')).toHaveTextContent(/POS Mobile/);
  });

  it('renders two panes on a tablet in landscape (1280×800)', async () => {
    setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);

    await render(<LoginScreen />);

    expect(screen.getByTestId('login-layout-two-pane')).toBeOnTheScreen();
    expect(screen.getByTestId('login-brand-panel')).toHaveTextContent(/POS Mobile/);
    expect(screen.queryByTestId('login-brand-header')).toBeNull();
    expect(screen.getByTestId('login-card')).toBeOnTheScreen();
  });

  it('keeps typed values (and password visibility) when the device rotates between layouts', async () => {
    setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height);
    const { rerender } = await render(<LoginScreen />);

    await fireEvent.changeText(screen.getByTestId('login-email'), 'cashier@pos.test');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'secret-pass');
    await fireEvent.press(screen.getByTestId('login-password-toggle'));

    // Phone → tablet landscape (single column → two panes).
    await act(async () => {
      setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);
    });
    await rerender(<LoginScreen />);

    expect(screen.getByTestId('login-layout-two-pane')).toBeOnTheScreen();
    expect(screen.getByTestId('login-email')).toHaveDisplayValue('cashier@pos.test');
    expect(screen.getByTestId('login-password')).toHaveDisplayValue('secret-pass');
    expect(screen.getByTestId('login-password')).toHaveProp('secureTextEntry', false);

    // And back to a short phone landscape.
    await act(async () => {
      setWindowSize(REFERENCE_SIZES.phoneLandscape.width, REFERENCE_SIZES.phoneLandscape.height);
    });
    await rerender(<LoginScreen />);

    expect(screen.getByTestId('login-layout-single')).toBeOnTheScreen();
    expect(screen.getByTestId('login-email')).toHaveDisplayValue('cashier@pos.test');
    expect(screen.getByTestId('login-password')).toHaveDisplayValue('secret-pass');
  });
});
