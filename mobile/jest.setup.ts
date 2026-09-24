/**
 * Global Jest setup (package.json → jest.setupFiles). Runs before each test file.
 */

// A LAN-style origin so src/services/api.ts can load. Individual tests may override it.
process.env.EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.50:8000';

// In-memory expo-secure-store. Tests reset it with `__resetSecureStore()`.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __resetSecureStore: () => store.clear(),
  };
});

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
}));

// Deterministic app version (sent as `app_version` on login).
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { name: 'POS Mobile', slug: 'pos-mobile', version: '1.0.0' } },
}));
