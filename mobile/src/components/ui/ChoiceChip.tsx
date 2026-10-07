import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';

/**
 * The selected look:
 * - `primary` (default): solid emerald, white text.
 * - `dark`: solid deep emerald, white text (e.g. the Orders status filter pills).
 * - `soft`: soft-green fill with an accent border and dark-emerald text (e.g. report Group-by).
 */
export type ChoiceChipTone = 'primary' | 'dark' | 'soft';

type ChoiceChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  /** `md` (default) is 44 high; `compact` is 40 (hitSlop keeps the touch area at 44). */
  size?: 'md' | 'compact';
  tone?: ChoiceChipTone;
  testID?: string;
};

type Tone = { background: string; pressed: string; border: string; pressedBorder: string; text: string };

const TONES: Record<ChoiceChipTone, Tone> = {
  primary: {
    background: colors.primary,
    pressed: colors.primaryPressed,
    border: colors.primary,
    pressedBorder: colors.primaryPressed,
    text: colors.onPrimary,
  },
  dark: {
    background: colors.primaryDark,
    pressed: colors.primaryDarkPressed,
    border: colors.primaryDark,
    pressedBorder: colors.primaryDarkPressed,
    text: colors.onPrimary,
  },
  soft: {
    background: colors.primarySoft,
    pressed: colors.primarySoftPressed,
    border: colors.accent,
    pressedBorder: colors.accent,
    text: colors.primaryDark,
  },
};

const COMPACT_SLOP_Y = (hitTarget.min - sizes.chipCompact) / 2;
const COMPACT_SLOP = { top: COMPACT_SLOP_Y, bottom: COMPACT_SLOP_Y, left: 0, right: 0 };

/**
 * A selectable filter pill (44, or 40 when `compact`): white with a hairline
 * border, or filled in its `tone` when selected.
 */
export const ChoiceChip = memo(function ChoiceChip({
  label,
  selected,
  onPress,
  icon,
  disabled = false,
  size = 'md',
  tone = 'primary',
  testID,
}: ChoiceChipProps) {
  const look = TONES[tone];
  const textColor = selected ? look.text : colors.textResting;
  const compact = size === 'compact';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={compact ? COMPACT_SLOP : undefined}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        compact && styles.compact,
        selected
          ? {
              backgroundColor: pressed ? look.pressed : look.background,
              borderColor: pressed ? look.pressedBorder : look.border,
            }
          : styles.unselected,
        pressed && !selected && styles.unselectedPressed,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon ? <Icon name={icon} size={iconSizes.sm} color={textColor} /> : null}
      <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + spacing.xxs,
    minHeight: hitTarget.min,
    maxWidth: '100%',
    borderRadius: radius.pill,
    borderWidth: sizes.borderWidth,
    paddingHorizontal: spacing.lg,
  },
  compact: {
    minHeight: sizes.chipCompact,
    paddingHorizontal: spacing.md + spacing.xxs,
  },
  unselected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  unselectedPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  label: {
    ...typography.control,
    flexShrink: 1,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
