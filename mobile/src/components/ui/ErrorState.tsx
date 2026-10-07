import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View, type RefreshControlProps } from 'react-native';

import { Button } from '@/components/ui/Button';
import { IconBadge } from '@/components/ui/IconBadge';
import type { IconName } from '@/components/ui/Icon';
import { colors, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type ErrorStateProps = {
  message: string;
  title?: string;
  icon?: IconName;
  onRetry: () => void;
  /** Label of the retry button (default "Retry"). */
  retryLabel?: string;
  retrying?: boolean;
  /** Optional pull-to-refresh (e.g. a list that failed to load). */
  refreshControl?: ReactElement<RefreshControlProps>;
  testID?: string;
};

/** Full-area error: icon, title, message and a Retry button (or `retryLabel`). Scrolls on short screens. */
export function ErrorState({
  message,
  title = 'Something went wrong',
  icon = 'cloud-offline-outline',
  onRetry,
  retryLabel = 'Retry',
  retrying = false,
  refreshControl,
  testID,
}: ErrorStateProps) {
  const { screenPaddingX, screenPaddingY, formMaxWidth, isCompactHeight } = useResponsive();

  return (
    <ScrollView
      style={styles.scroll}
      refreshControl={refreshControl}
      contentContainerStyle={[styles.content, { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }]}
    >
      <View style={[styles.inner, { maxWidth: formMaxWidth }]} testID={testID} accessibilityRole="alert">
        <IconBadge icon={icon} tone="danger" size={isCompactHeight ? 'md' : 'lg'} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <Button
          title={retryLabel}
          leftIcon="refresh"
          onPress={onRetry}
          loading={retrying}
          style={styles.button}
          testID={testID ? `${testID}-retry` : undefined}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
});
