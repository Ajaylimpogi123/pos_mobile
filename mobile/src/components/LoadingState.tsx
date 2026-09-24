import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, fontSizes, spacing } from '@/constants/theme';

type LoadingStateProps = {
  message?: string;
  testID?: string;
};

/** Full-area spinner for first loads. */
export function LoadingState({ message = 'Loading…', testID }: LoadingStateProps) {
  return (
    <View style={styles.container} testID={testID} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.message}>{message}</Text>
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
  message: {
    fontSize: fontSizes.lg,
    color: colors.textMuted,
  },
});
