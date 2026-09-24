import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { useSessionBootstrap } from '@/hooks/useSessionBootstrap';
import { restoreSession } from '@/services/session';
import { useSessionStore } from '@/stores/session';

/**
 * Root layout and auth gate.
 * - While the session is restoring: a loading state, or an error with Retry
 *   when the server can't be reached and there is no cached user.
 * - Then a Stack whose route groups are gated with `Stack.Protected`
 *   (Expo Router protected routes): `(pos)` only when signed in, `(auth)`
 *   only when signed out. Changing the status redirects automatically.
 */
export default function RootLayout() {
  useSessionBootstrap();

  const status = useSessionStore((state) => state.status);
  const restoreError = useSessionStore((state) => state.restoreError);

  if (status === 'restoring') {
    return (
      <>
        <StatusBar style="dark" />
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
      </>
    );
  }

  const signedIn = status === 'signedIn';

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(pos)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
