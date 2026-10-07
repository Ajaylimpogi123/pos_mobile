/**
 * Test-only helpers. Never import from app code.
 */
import type { AuthUser } from '@/services/types';

/** AuthUser exactly as in the contract example (docs/api-contract.md). */
export const cashierUser: AuthUser = {
  id: 3,
  name: 'Carla Cashier',
  email: 'cashier@pos.test',
  is_active: true,
  last_login_at: '2026-09-24T01:30:00Z',
  role: { id: 3, slug: 'cashier', name: 'Cashier', max_discount_percent: 10, is_admin: false },
  branch: { id: 1, code: 'MAIN', name: 'Main Branch', timezone: 'Asia/Manila', day_start_time: '04:00' },
  permissions: ['discount.apply', 'sale.create', 'shift.close', 'shift.open'],
};

/** A minimal fetch Response stand-in. `body === undefined` means an empty body. */
export function mockResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

type SecureStoreMock = {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  __resetSecureStore: () => void;
};

/** The in-memory expo-secure-store mock from jest.setup.ts. */
export function secureStoreMock(): SecureStoreMock {
  return jest.requireMock('expo-secure-store') as SecureStoreMock;
}

/** Installs a jest.fn() as global fetch and returns it. */
export function installFetchMock(): jest.Mock {
  const fetchMock = jest.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Lets pending timers (e.g. the deferred 401 redirect) and promises run. */
export function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export { DEFAULT_WINDOW, resetWindowSize, setWindowSize } from './window';

/** The six reference sizes (width × height) every screen is checked at. */
export const REFERENCE_SIZES = {
  phonePortraitSmall: { width: 360, height: 640 },
  phoneLandscapeSmall: { width: 640, height: 360 },
  phonePortrait: { width: 430, height: 932 },
  phoneLandscape: { width: 932, height: 430 },
  tabletPortrait: { width: 800, height: 1280 },
  tabletLandscape: { width: 1280, height: 800 },
} as const;
