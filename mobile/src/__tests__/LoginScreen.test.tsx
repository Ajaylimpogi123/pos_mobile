import { fireEvent, render, screen } from '@testing-library/react-native';

import LoginScreen from '@/app/(auth)/login';
import { ApiError, ApiValidationError } from '@/services/api';
import { login } from '@/services/auth';
import { secureStoreMock } from '@/test-utils';

jest.mock('@/services/auth', () => ({
  login: jest.fn(),
  getMe: jest.fn(),
  logout: jest.fn(),
}));

const loginMock = login as jest.MockedFunction<typeof login>;

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  loginMock.mockReset();
});

async function fillAndSubmit() {
  await fireEvent.changeText(screen.getByTestId('login-email'), 'cashier@pos.test');
  await fireEvent.changeText(screen.getByTestId('login-password'), 'wrong');
  await fireEvent.changeText(screen.getByTestId('login-device-code'), 'TAB99');
  await fireEvent.press(screen.getByTestId('login-submit'));
}

describe('LoginScreen', () => {
  it('prefills the remembered device code', async () => {
    await secureStoreMock().setItemAsync('pos.device.code', 'TAB01');

    await render(<LoginScreen />);

    expect(await screen.findByDisplayValue('TAB01')).toBeTruthy();
  });

  it('shows 422 messages under the matching fields', async () => {
    loginMock.mockRejectedValueOnce(
      new ApiValidationError('These credentials do not match our records. (and 1 more error)', {
        email: ['These credentials do not match our records.'],
        device_code: ['This device is not registered.'],
      }),
    );

    await render(<LoginScreen />);
    await fillAndSubmit();

    expect(await screen.findByTestId('login-email-error')).toHaveTextContent(
      'These credentials do not match our records.',
    );
    expect(screen.getByTestId('login-device-code-error')).toHaveTextContent('This device is not registered.');
    expect(screen.queryByTestId('login-password-error')).toBeNull();
    expect(screen.queryByTestId('login-banner')).toBeNull();
    expect(loginMock).toHaveBeenCalledWith({
      email: 'cashier@pos.test',
      password: 'wrong',
      device_code: 'TAB99',
      app_version: '1.0.0',
    });
  });

  it('shows 429 in a banner', async () => {
    loginMock.mockRejectedValueOnce(new ApiError('Too Many Attempts.', { status: 429, kind: 'http' }));

    await render(<LoginScreen />);
    await fillAndSubmit();

    expect(await screen.findByTestId('login-banner')).toHaveTextContent(/Too many login attempts/);
  });

  it('clears a field error when that field is edited', async () => {
    loginMock.mockRejectedValueOnce(
      new ApiValidationError('The password field is required.', {
        password: ['The password field is required.'],
      }),
    );

    await render(<LoginScreen />);
    await fillAndSubmit();
    expect(await screen.findByTestId('login-password-error')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('login-password'), 'password');

    expect(screen.queryByTestId('login-password-error')).toBeNull();
  });
});
