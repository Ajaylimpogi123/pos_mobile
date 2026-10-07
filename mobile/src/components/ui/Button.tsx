import { memo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import {
  colors,
  hitTarget,
  iconSizes,
  pressedScale,
  radius,
  shadows,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';

/**
 * - `primary`: solid emerald, white text.
 * - `secondary`: white with a hairline border, dark text.
 * - `tonal`: soft green fill, dark-emerald text.
 * - `ghost`: no fill, emerald text.
 * - `danger`: white with a soft red outline, red text.
 * - `strong`: solid deep emerald (primaryDark), white text (e.g. Export CSV).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger' | 'strong';
export type ButtonSize = 'md' | 'lg' | 'xl';

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** `md` is 48 high (controls), `lg` is 56 (Sign in), `xl` is 60 (Charge, Complete sale, New sale). */
  size?: ButtonSize;
  leftIcon?: IconName;
  /** An icon after the label (e.g. the → on Sign in). */
  rightIcon?: IconName;
  /** Shows a spinner and blocks presses. */
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

type Palette = { background: string; pressed: string; text: string; border: string };

const palettes: Record<ButtonVariant, Palette> = {
  primary: { background: colors.primary, pressed: colors.primaryPressed, text: colors.onPrimary, border: colors.primary },
  secondary: { background: colors.surface, pressed: colors.surfaceMuted, text: colors.text, border: colors.border },
  tonal: {
    background: colors.primarySoft,
    pressed: colors.primarySoftPressed,
    text: colors.primaryDark,
    border: colors.primarySoft,
  },
  ghost: { background: colors.transparent, pressed: colors.primarySoft, text: colors.primary, border: colors.transparent },
  danger: { background: colors.surface, pressed: colors.dangerSoft, text: colors.danger, border: colors.dangerBorder },
  strong: {
    background: colors.primaryDark,
    pressed: colors.primaryDarkPressed,
    text: colors.onPrimary,
    border: colors.primaryDark,
  },
};

/** Disabled (not loading): a flat grey-green fill with muted text, like the Foundations board. */
const disabledPalette: Palette = { background: colors.border, pressed: colors.border, text: colors.textMuted, border: colors.border };
const disabledGhost: Palette = { ...disabledPalette, background: colors.transparent, border: colors.transparent };

/**
 * Button: 48 dp controls, a 56 dp large and a 60 dp extra-large CTA (radius 12 / 14), optional
 * left and right icons, loading, pressed (immediate: colour + a subtle
 * shrink) and disabled states. The large primary CTA gets a soft green glow.
 */
export const Button = memo(function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  loading = false,
  disabled = false,
  style,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const greyedOut = disabled && !loading;
  let palette = palettes[variant];
  if (greyedOut) palette = variant === 'ghost' ? disabledGhost : disabledPalette;
  const large = size !== 'md';
  const glow = large && variant === 'primary' && !greyedOut;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        large ? styles.large : styles.medium,
        size === 'xl' && styles.xl,
        { backgroundColor: pressed ? palette.pressed : palette.background, borderColor: palette.border },
        glow && shadows.primary,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} testID={testID ? `${testID}-spinner` : undefined} />
      ) : (
        <View style={styles.content}>
          {leftIcon ? <Icon name={leftIcon} size={iconSizes.md} color={palette.text} /> : null}
          <Text style={[large ? styles.labelLarge : styles.label, { color: palette.text }]} numberOfLines={1}>
            {title}
          </Text>
          {rightIcon ? <Icon name={rightIcon} size={iconSizes.md} color={palette.text} /> : null}
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    minWidth: hitTarget.min,
    paddingHorizontal: spacing.xl,
    borderWidth: sizes.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medium: {
    minHeight: hitTarget.primary,
    borderRadius: radius.md,
  },
  large: {
    minHeight: hitTarget.large,
    borderRadius: radius.cta,
  },
  xl: {
    minHeight: sizes.cta,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.button,
    flexShrink: 1,
  },
  labelLarge: {
    ...typography.buttonLarge,
    flexShrink: 1,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
});
