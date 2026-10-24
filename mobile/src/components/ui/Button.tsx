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
  sizes,
  spacing,
  typography,
} from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * Variants (MASTER §3 and §6):
 * - `primary`: the green pill ("+ Add", Checkout, Save), white 15–16 / 600 text.
 * - `secondary`: the outline button: white, 1 px `border`, radius 8, 14 / 500.
 * - `tonal`: the same outline button (MASTER §6 retires the tonal look).
 * - `ghost`: a quiet text button: green text, no fill.
 * - `danger`: a destructive outline button (red text and outline).
 * - `destructive`: a filled destructive button (a confirmed "Void order").
 * - `strong`: the dark neutral button ("New sale", Export CSV), radius 8.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger' | 'destructive' | 'strong';
export type ButtonSize = 'md' | 'lg' | 'xl';

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** `md`: 48 (pill) or 44 (outline, dark, quiet). `lg` and `xl`: the 52 dp CTA (Sign in, Checkout, Complete sale). */
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

const outline: Palette = { background: colors.surface, pressed: colors.accent, text: colors.text, border: colors.border };

const palettes: Record<ButtonVariant, Palette> = {
  primary: { background: colors.green, pressed: colors.greenHover, text: colors.onPrimary, border: colors.green },
  secondary: outline,
  tonal: outline,
  ghost: { background: colors.transparent, pressed: colors.accent, text: colors.green, border: colors.transparent },
  danger: { background: colors.surface, pressed: colors.dangerSoft, text: colors.danger, border: colors.dangerBorder },
  destructive: {
    background: colors.destructiveFill,
    pressed: colors.destructiveFillPressed,
    text: colors.onPrimary,
    border: colors.destructiveFill,
  },
  strong: { background: colors.dark, pressed: colors.darkPressed, text: colors.onDark, border: colors.dark },
};

/** Disabled (not loading): #E5E7EB with #4B5563 text (MASTER §3); put the reason in the label. */
const disabledPalette: Palette = { background: colors.disabled, pressed: colors.disabled, text: colors.onDisabled, border: colors.disabled };
const disabledGhost: Palette = { ...disabledPalette, background: colors.transparent, border: colors.transparent };

/** Pill-shaped variants (fully round); the others use the 8 px radius. */
const PILL: ReadonlySet<ButtonVariant> = new Set(['primary', 'destructive']);

/**
 * Button: 48 dp primary pills, 44 dp outline / dark / quiet buttons, and a
 * 52 dp large CTA (Sign in, Checkout). Optional left and right icons,
 * loading, pressed (immediate: colour + a 0.98 shrink, dropped under
 * reduce-motion) and disabled states. No glow (MASTER §1.6).
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
  const pill = PILL.has(variant);
  const reduceMotion = useReducedMotion();

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
        pill ? styles.pill : styles.square,
        large && styles.large,
        { backgroundColor: pressed ? palette.pressed : palette.background, borderColor: palette.border },
        pressed && !reduceMotion && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} testID={testID ? `${testID}-spinner` : undefined} />
      ) : (
        <View style={styles.content}>
          {leftIcon ? <Icon name={leftIcon} size={iconSizes.md} color={palette.text} /> : null}
          <Text style={[large ? styles.labelLarge : pill ? styles.label : styles.labelOutline, { color: palette.text }]} numberOfLines={1}>
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
  pill: {
    minHeight: hitTarget.primary,
    borderRadius: radius.pill,
  },
  square: {
    minHeight: hitTarget.min,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  large: {
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
  labelOutline: {
    ...typography.control,
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
