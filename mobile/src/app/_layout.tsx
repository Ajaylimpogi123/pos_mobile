import { Figtree_400Regular } from '@expo-google-fonts/figtree/400Regular';
import { Figtree_500Medium } from '@expo-google-fonts/figtree/500Medium';
import { Figtree_600SemiBold } from '@expo-google-fonts/figtree/600SemiBold';
import { Figtree_700Bold } from '@expo-google-fonts/figtree/700Bold';
import { Figtree_800ExtraBold } from '@expo-google-fonts/figtree/800ExtraBold';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { UpdateRequiredScreen } from '@/components/device/UpdateRequiredScreen';
import { AppErrorBoundary } from '@/components/errors/AppErrorBoundary';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { Screen } from '@/components/ui/Screen';
import { ToastProvider } from '@/components/ui/Toast';
import { colors, fontFamilies } from '@/constants/theme';
import { installGlobalErrorHandlers } from '@/errors/globalHandlers';
import { useVersionGate } from '@/hooks/device/useVersionGate';
import { useCatalogueSyncTriggers } from '@/hooks/useCatalogueSyncTriggers';
import { useDatabaseBootstrap } from '@/hooks/useDatabaseBootstrap';
import { useDeviceHealthTriggers } from '@/hooks/useDeviceHealthTriggers';
import { useOfflineSalesTriggers } from '@/hooks/useOfflineSalesTriggers';
import { usePrintingBootstrap } from '@/hooks/usePrintingBootstrap';
import { useSessionBootstrap } from '@/hooks/useSessionBootstrap';
import { queryClient } from '@/services/queryClient';
import { restoreSession } from '@/services/session';
import { useSessionStore } from '@/stores/session';

/**
 * Root layout and auth gate.
 * - `QueryClientProvider` wraps everything (TanStack Query caches server data).
 * - While the session is restoring: a loading state, or an error with Retry
 *   when the server can't be reached and there is no cached user.
 * - Then a Stack whose route groups are gated with `Stack.Protected`
 *   (Expo Router protected routes): `(app)` (the app shell: sidebar + the
 *   dashboard, customers, menu and staff) only when signed in, `(auth)` only
 *   when signed out. Changing the status redirects automatically. The
 *   per-permission guards live in `(app)/_layout.tsx` and below.
 * - Signing out clears the query cache, so the next user never sees the
 *   previous user's data. The on-device menu (SQLite) is kept: it is global
 *   and holds no cost (contract → Catalogue Sync: "Logout keeps the catalogue").
 * - The on-device database is opened and migrated at startup, next to (never
 *   blocking) the session restore, and the catalogue-sync triggers are
 *   mounted here (after login / restore, foreground, every 5 minutes).
 * - Printing starts here too: startup recovery of the print queue and the
 *   cached print config (Phase 4). The print config syncs on the same triggers.
 * - Offline Sales (Phase 5): device registration, the outbox worker (also on
 *   reconnect) and the stock cache are triggered here. Logout keeps the outbox.
 *
 * - Fonts (Figtree, 5 weights; MASTER.md §1.5) load from the bundle while the
 *   native splash stays up. The bootstraps above start at the same time (the
 *   gate renders nothing until the fonts are ready, so no text ever flashes
 *   in the system font). When the fonts load, or fail, the splash hides; on
 *   a failure the app continues with the system font and never blocks.
 *
 * - Toasts (MASTER §3): one host at the top, above every route (`ToastProvider`).
 *
 * - Hardening & Pilot (Phase 8): the global JS error handler and unhandled
 *   rejections are installed at module load; a root error boundary shows
 *   "Something went wrong" with Restart app; the heartbeat, version check and
 *   error-queue triggers run here; below `min_version` the blocking
 *   "Update required" screen replaces the routes while every sync keeps running.
 *
 * The app follows device rotation (`"orientation": "default"` in app.json);
 * nothing here locks it.
 */
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
installGlobalErrorHandlers();

const FONTS = {
  [fontFamilies.regular]: Figtree_400Regular,
  [fontFamilies.medium]: Figtree_500Medium,
  [fontFamilies.semibold]: Figtree_600SemiBold,
  [fontFamilies.bold]: Figtree_700Bold,
  [fontFamilies.heavy]: Figtree_800ExtraBold,
};

export default function RootLayout() {
  useDatabaseBootstrap();
  const [fontsLoaded, fontError] = useFonts(FONTS);
  const fontsReady = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (fontsReady) SplashScreen.hide();
  }, [fontsReady]);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthGate fontsReady={fontsReady} />
        </ToastProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

function AuthGate({ fontsReady }: { fontsReady: boolean }) {
  useSessionBootstrap();
  useCatalogueSyncTriggers();
  usePrintingBootstrap();
  useOfflineSalesTriggers();
  useDeviceHealthTriggers();
  const gate = useVersionGate();

  const status = useSessionStore((state) => state.status);
  const restoreError = useSessionStore((state) => state.restoreError);

  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status]);

  // The native splash is still up: render nothing until the fonts are ready (or failed).
  if (!fontsReady) return null;

  if (status === 'restoring') {
    return (
      <Screen testID="restore-screen">
        {restoreError ? (
          <ErrorState
            title="Can't restore your session"
            message={restoreError}
            onRetry={() => void restoreSession()}
            testID="restore-error"
          />
        ) : (
          <LoadingState message="Restoring session…" testID="restore-loading" />
        )}
      </Screen>
    );
  }

  if (gate.status === 'update_required' && gate.info) {
    return (
      <UpdateRequiredScreen
        current={gate.current}
        minVersion={gate.info.min_version}
        updateUrl={gate.info.update_url}
        salesToSend={gate.salesToSend}
      />
    );
  }

  const signedIn = status === 'signedIn';

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
