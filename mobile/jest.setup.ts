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

// Fonts (Plus Jakarta Sans) count as loaded at once; the splash screen is a no-op.
jest.mock('expo-font', () => ({
  ...jest.requireActual<typeof import('expo-font')>('expo-font'),
  useFonts: jest.fn(() => [true, null]),
}));

jest.mock('expo-splash-screen', () => ({
  __esModule: true,
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => undefined),
  hide: jest.fn(),
  setOptions: jest.fn(),
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: {
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: jest.fn(() => ({})),
  // The app shell reads the current path to mark the active sidebar module.
  usePathname: jest.fn(() => '/'),
  // Runs the callback once on mount, like a screen gaining focus the first time.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));

// React Native's FormData (accepts `{ uri, name, type }` file parts, exposes getParts()),
// so multipart requests look in tests exactly as they do on a device. Node's own
// FormData would stringify the file part to "[object Object]".
globalThis.FormData = jest.requireActual('react-native/Libraries/Network/FormData').default;

// Native pickers: tests set the results they need (see src/test-utils/imagePicker.ts).
jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true, expires: 'never' })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

jest.mock('expo-image-manipulator', () => {
  type MockManipulatorContext = { resize: jest.Mock; renderAsync: jest.Mock; release: jest.Mock };
  const saveAsync = jest.fn(async () => ({ uri: 'file:///cache/manipulated.jpg', width: 1024, height: 768 }));
  const context: MockManipulatorContext = {
    resize: jest.fn((): MockManipulatorContext => context),
    renderAsync: jest.fn(async () => ({ saveAsync, release: jest.fn() })),
    release: jest.fn(),
  };
  return {
    __esModule: true,
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
    ImageManipulator: { manipulate: jest.fn(() => context) },
    __context: context,
    __saveAsync: saveAsync,
  };
});

// Controllable window size (see src/test-utils/window.ts). Defaults to the
// primary device, a 1280×800 tablet in landscape. `setWindowSize()` re-renders
// subscribed components, like a real rotation.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  const windowStore = jest.requireActual<typeof import('./src/test-utils/window')>('./src/test-utils/window');
  return {
    __esModule: true,
    default: function useWindowDimensions() {
      return useSyncExternalStore(windowStore.subscribeWindowSize, windowStore.getWindowSize);
    },
  };
});

// expo-network: online by default. Tests go offline with
// `(jest.requireMock('expo-network').getNetworkStateAsync as jest.Mock).mockResolvedValue({ isConnected: false, ... })`.
jest.mock('expo-network', () => ({
  __esModule: true,
  NetworkStateType: { NONE: 'NONE', UNKNOWN: 'UNKNOWN', WIFI: 'WIFI', CELLULAR: 'CELLULAR' },
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true, type: 'WIFI' })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true, type: 'WIFI' })),
}));

// expo-crypto is native: its secure random bytes (used for ULIDs) come from Node's CSPRNG here.
jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomFillSync } = require('node:crypto') as { randomFillSync: (buffer: Uint8Array) => Uint8Array };
  return {
    __esModule: true,
    getRandomBytes: jest.fn((byteCount: number) => randomFillSync(new Uint8Array(byteCount))),
  };
});

// expo-sqlite is native. Tests that need the on-device database mock `@/db/client` with an
// in-memory node:sqlite database (src/test-utils/database.ts). Anything else that opens the
// real database gets this error, which `prepareDatabase()` reports as "database unavailable",
// so screens that trigger a catalogue sync (e.g. the menu admin) never reach the network.
jest.mock('expo-sqlite', () => ({
  __esModule: true,
  openDatabaseSync: jest.fn(() => {
    throw new Error('expo-sqlite is not available under Jest: mock @/db/client (see src/test-utils/database.ts).');
  }),
  addDatabaseChangeListener: jest.fn(() => ({ remove: jest.fn() })),
}));
