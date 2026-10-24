import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { iconSizes, radius, sizes, spacing, status, typography } from '@/constants/theme';

export type BannerVariant = 'error' | 'warning' | 'info' | 'success';

type BannerProps = {
  message: string;
  variant?: BannerVariant;
  testID?: string;
};

type BannerPalette = { background: string; border: string; icon: string; text: string; glyph: IconName };

/** The MASTER §1.3 status families: tint, border, and the status colour for the icon and text. */
export const BANNER_PALETTES: Record<BannerVariant, BannerPalette> = {
  error: { background: status.cancelled.tint, border: status.cancelled.border, icon: status.cancelled.color, text: status.cancelled.text, glyph: 'alert-circle' },
  warning: { background: status.caution.tint, border: status.caution.border, icon: status.caution.color, text: status.caution.text, glyph: 'warning' },
  info: { background: status.processing.tint, border: status.processing.border, icon: status.processing.color, text: status.processing.text, glyph: 'information-circle' },
  success: { background: status.completed.tint, border: status.completed.border, icon: status.completed.color, text: status.completed.text, glyph: 'checkmark-circle' },
};
const palettes = BANNER_PALETTES;

/** Inline message for non-field errors and notices. */
export function Banner({ message, variant = 'error', testID }: BannerProps) {
  const palette = palettes[variant];

  return (
    <View
      accessibilityRole={variant === 'error' ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      testID={testID}
      style={[styles.banner, { backgroundColor: palette.background, borderColor: palette.border }]}
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
    borderWidth: sizes.borderWidth,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  text: {
    ...typography.bodySm,
    flex: 1,
  },
});
