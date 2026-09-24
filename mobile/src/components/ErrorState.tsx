import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { colors, fontSizes, fontWeights, sizes, spacing } from '@/constants/theme';

type ErrorStateProps = {
  message: string;
  title?: string;
  onRetry: () => void;
  retrying?: boolean;
  testID?: string;
};

/** Full-area error with the message and a Retry button. */
export function ErrorState({
  message,
  title = 'Something went wrong',
  onRetry,
  retrying = false,
  testID,
}: ErrorStateProps) {
  return (
    <View style={styles.container} testID={testID} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Button title="Retry" onPress={onRetry} loading={retrying} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: colors.text,
    textAlign: 'center',
  },
  message: {
    fontSize: fontSizes.md,
    color: colors.textMuted,
    textAlign: 'center',
  },
  button: {
    minWidth: sizes.actionButtonMinWidth,
  },
});
