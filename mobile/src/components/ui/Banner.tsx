import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, iconSizes, radius, spacing, typography } from '@/constants/theme';

export type BannerVariant = 'error' | 'warning' | 'info' | 'success';

type BannerProps = {
  message: string;
  variant?: BannerVariant;
  testID?: string;
};

const palettes: Record<BannerVariant, { background: string; icon: string; text: string; glyph: IconName }> = {
  error: { background: colors.dangerSoft, icon: colors.danger, text: colors.dangerText, glyph: 'alert-circle' },
  warning: { background: colors.warningSoft, icon: colors.warning, text: colors.warningText, glyph: 'warning' },
  info: { background: colors.infoSoft, icon: colors.info, text: colors.infoText, glyph: 'information-circle' },
  success: { background: colors.successSoft, icon: colors.success, text: colors.successText, glyph: 'checkmark-circle' },
};

/** Inline message for non-field errors and notices. */
export function Banner({ message, variant = 'error', testID }: BannerProps) {
  const palette = palettes[variant];

  return (
    <View
      accessibilityRole={variant === 'error' ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      testID={testID}
      style={[styles.banner, { backgroundColor: palette.background }]}
    >
      <Icon name={palette.glyph} size={iconSizes.md} color={palette.icon} />
      <Text style={[styles.text, { color: palette.text }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  text: {
    ...typography.bodySm,
    flex: 1,
  },
});
