import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { IconBadge } from '@/components/ui/IconBadge';
import { colors, layout, spacing, typography } from '@/constants/theme';
import { requestErrorFlush } from '@/errors/errorQueue';
import { useResponsive } from '@/hooks/useResponsive';
import { useOfflineStore } from '@/stores/offline';
import { requestOutboxSync } from '@/sync/outboxSync';

type Props = {
  current: string | null;
  minVersion: string;
  updateUrl: string | null;
  salesToSend: number;
};

function salesLine(count: number): string {
  if (count === 0) return 'Every sale from this tablet has reached the server.';
  return `${count} ${count === 1 ? 'sale' : 'sales'} still to send. They keep syncing while this screen is open.`;
}

/**
 * Hardening & Pilot §D: the blocking **Update required** screen (this app is
 * below the server's `min_version`). The outbox and the error queue keep
 * syncing behind it (their triggers live in the root layout), and it shows
 * how many sales are still to send. Nothing is blocked server-side.
 */
export function UpdateRequiredScreen({ current, minVersion, updateUrl, salesToSend }: Props) {
  const { screenPaddingX, screenPaddingY } = useResponsive();
  const syncing = useOfflineStore((state) => state.syncing);

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safe} testID="update-required-screen">
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }]}>
        <View style={styles.inner}>
          <IconBadge icon="cloud-download-outline" tone="info" size="lg" />
          <Text style={styles.title} accessibilityRole="header">
            Update required
          </Text>
          <Text style={styles.message}>
            This version of the app ({current ?? 'unknown'}) is no longer supported. Install version {minVersion} or newer
            to keep selling.
          </Text>
          <Banner variant={salesToSend > 0 ? 'warning' : 'success'} message={salesLine(salesToSend)} testID="update-required-sales" />
          {updateUrl ? (
            <Button
              title="Get the update"
              leftIcon="download-outline"
              size="lg"
              onPress={() => void Linking.openURL(updateUrl).catch(() => undefined)}
              style={styles.button}
              testID="update-required-open"
            />
          ) : (
            <Text style={styles.hint} testID="update-required-ask">
              Ask a manager for the update link.
            </Text>
          )}
          <Button
            title="Sync now"
            leftIcon="sync"
            variant="secondary"
            loading={syncing}
            disabled={syncing}
            onPress={() => {
              void requestOutboxSync({ force: true });
              void requestErrorFlush();
            }}
            style={styles.button}
            testID="update-required-sync"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: layout.formMaxWidth,
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  hint: {
    ...typography.bodyStrong,
    color: colors.text,
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
  },
});
