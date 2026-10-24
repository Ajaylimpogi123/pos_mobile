import { memo } from 'react';
import { Pressable, StyleSheet, type Insets, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, opacity, pressedScale, radius, sizes } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * - `accent`: the round green button (e.g. "+" New): a primary action.
 * - `primary`: solid green.
 * - `soft`: the neutral `accent` fill with a dark glyph (secondary actions).
 * - `bar`: a quiet grey, for the header's back / menu buttons.
 * - `ghost`: no fill until pressed.
 */
export type IconButtonVariant = 'accent' | 'primary' | 'soft' | 'bar' | 'ghost';
export type IconButtonSize = 'md' | 'lg';

type IconButtonProps = {
  icon: IconName;
  /** Required: an icon alone has no text for screen readers. */
  accessibilityLabel: string;
  onPress: () => void;
  variant?: IconButtonVariant;
  /** `md` is 44×44 (hitSlop grows its touch area to 48), `lg` is 48×48. */
  size?: IconButtonSize;
  disabled?: boolean;
  hitSlop?: Insets;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
};

const palettes = {
  accent: { background: colors.green, pressed: colors.greenHover, icon: colors.onPrimary },
  primary: { background: colors.green, pressed: colors.greenHover, icon: colors.onPrimary },
  soft: { background: colors.accent, pressed: colors.borderStrong, icon: colors.text },
  bar: { background: colors.transparent, pressed: colors.accent, icon: colors.text },
  ghost: { background: colors.transparent, pressed: colors.accent, icon: colors.textSecondary },
} as const;

/** Grows a 44 dp button's touch area to 48. */
const MD_SLOP = (hitTarget.primary - sizes.iconButton.md) / 2;
const DEFAULT_MD_HIT_SLOP: Insets = { top: MD_SLOP, bottom: MD_SLOP, left: MD_SLOP, right: MD_SLOP };

/** Round icon-only button (44 or 48), with immediate pressed and disabled states. */
export const IconButton = memo(function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'accent',
  size = 'md',
  disabled = false,
  hitSlop,
  style,
  testID,
  accessibilityHint,
}: IconButtonProps) {
  const palette = palettes[variant];
  const reduceMotion = useReducedMotion();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hitSlop ?? (size === 'md' ? DEFAULT_MD_HIT_SLOP : undefined)}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.large : styles.medium,
        { backgroundColor: pressed ? palette.pressed : palette.background },
        pressed && !reduceMotion && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon name={icon} size={size === 'lg' ? iconSizes.lg : iconSizes.md} color={palette.icon} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medium: {
    width: sizes.iconButton.md,
    height: sizes.iconButton.md,
  },
  large: {
    width: sizes.iconButton.lg,
    height: sizes.iconButton.lg,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
