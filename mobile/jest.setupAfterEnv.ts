/**
 * Per-file Jest setup that runs after the test framework is installed
 * (package.json → jest.setupFilesAfterEnv), before the file's first test.
 *
 * Why: React Native loads its components lazily. `react-native/index.js`
 * exposes each one through a getter that `require`s it on first access, and
 * babel-preset-expo compiles `import { FlatList } from 'react-native'` to a
 * property read at use time. So the first test in a file that renders a screen
 * also paid for loading Pressable, ScrollView, TextInput, FlatList (and their
 * VirtualizedList / Pressability / Animated internals): about 1.3 s when the
 * file runs alone, and 8 to 12 s during a full run, when every worker loads the
 * same modules at once. On a busy machine that one-off load pushed the first
 * test past its 15 s timeout, and the timed-out test's leftover work then
 * leaked into the next test (e.g. SellCart's "never adds an unavailable
 * product" saw a line added by the previous, timed-out test).
 *
 * Loading them here instead happens while the file is set up, which no test
 * timeout covers, so each test's time measures only its own behaviour. Only
 * `.tsx` suites render screens; the plain `.ts` suites (pure logic, stores,
 * services) skip it and stay fast.
 *
 * It also sets React Native Testing Library's async deadline. This must happen
 * here, not in jest.setup.ts: RNTL registers its automatic `afterEach(cleanup)`
 * when it is first imported, and `afterEach` doesn't exist yet in setupFiles,
 * so importing RNTL there would silently turn off the unmount between tests.
 */
import { configure } from '@testing-library/react-native';
import * as ReactNative from 'react-native';

// The deadline for `findBy*` / `waitFor` ("this eventually appears"). RNTL's
// default of 1 s is wall-clock time, and a step here (mocked fetch → TanStack
// Query → re-render) takes a few ms alone but can stall for seconds while
// other Jest workers hog the CPU. 5 s keeps those waits reliable on a loaded
// machine, and still fails well inside the 15 s test timeout (package.json →
// jest.testTimeout), so a real failure reports the missing element and the
// rendered tree instead of a bare "Exceeded timeout". A wait that passes
// returns as soon as it passes, so this doesn't slow green runs.
configure({ asyncUtilTimeout: 5000 });

if (expect.getState().testPath?.endsWith('.tsx')) {
  // Every React Native component and API the app imports (src/**: `from 'react-native'`).
  const used: unknown[] = [
    ReactNative.View,
    ReactNative.Text,
    ReactNative.StyleSheet,
    ReactNative.Pressable,
    ReactNative.ScrollView,
    ReactNative.ActivityIndicator,
    ReactNative.TextInput,
    ReactNative.RefreshControl,
    ReactNative.FlatList,
    ReactNative.Modal,
    ReactNative.KeyboardAvoidingView,
    ReactNative.Switch,
    ReactNative.Animated,
    ReactNative.Easing,
    ReactNative.Platform,
    ReactNative.AppState,
    ReactNative.Linking,
    ReactNative.BackHandler,
  ];
  if (used.some((loaded) => loaded === undefined)) {
    throw new Error('jest.setupAfterEnv.ts: a React Native export failed to load.');
  }
}
