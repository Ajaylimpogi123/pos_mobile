import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View, type RefreshControlProps } from 'react-native';

import { Button } from '@/components/ui/Button';
import { IconBadge } from '@/components/ui/IconBadge';
import type { IconName } from '@/components/ui/Icon';
import { colors, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type EmptyStateProps = {
  title: string;
  message?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional pull-to-refresh (e.g. an empty list). */
  refreshControl?: ReactElement<RefreshControlProps>;
  testID?: string;
};

/** Shown when a list or screen has nothing to display yet. Scrolls on short screens. */
export function EmptyState({
  title,
  message,
  icon = 'file-tray-outline',
  actionLabel,
  onAction,
  refreshControl,
  testID,
}: EmptyStateProps) {
  const { screenPaddingX, screenPaddingY, formMaxWidth, isCompactHeight } = useResponsive();

  return (
    <ScrollView
      style={styles.scroll}
      refreshControl={refreshControl}
      contentContainerStyle={[styles.content, { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }]}
    >
      <View style={[styles.inner, { maxWidth: formMaxWidth }]} testID={testID}>
        <IconBadge icon={icon} tone="primary" size={isCompactHeight ? 'md' : 'lg'} />
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {actionLabel && onAction ? (
          <Button
            title={actionLabel}
            onPress={onAction}
            variant="tonal"
            style={styles.button}
            testID={testID ? `${testID}-action` : undefined}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
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
    marginTop: spacing.sm,
  },
});
