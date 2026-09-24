import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSizes, radii, sizes, spacing } from '@/constants/theme';

export type BannerVariant = 'error' | 'info';

type BannerProps = {
  message: string;
  variant?: BannerVariant;
  testID?: string;
};

const variantStyles = {
  error: { background: colors.errorBackground, border: colors.errorBorder, text: colors.errorText },
  info: { background: colors.infoBackground, border: colors.infoBorder, text: colors.infoText },
} as const;

/** Inline message for non-field errors and notices. */
export function Banner({ message, variant = 'error', testID }: BannerProps) {
  const palette = variantStyles[variant];

  return (
    <View
      accessibilityRole={variant === 'error' ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      testID={testID}
      style={[styles.banner, { backgroundColor: palette.background, borderColor: palette.border }]}
    >
      <Text style={[styles.text, { color: palette.text }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: sizes.borderWidth,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  text: {
    fontSize: fontSizes.md,
  },
});
