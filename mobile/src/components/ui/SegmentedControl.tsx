import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import {
  colors,
  hitTarget,
  iconSizes,
  opacity,
  radius,
  shadows,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: IconName;
  testID?: string;
};

type SegmentedControlProps<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** `md` (default) is a 48 dp track; `compact` is 36 (card headers). Segments keep a 44 touch area via hitSlop. */
  size?: 'md' | 'compact';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The track's inner padding; each segment's touch area grows by it, so the whole 48 dp track is tappable. */
const TRACK_PADDING = spacing.xs;
const SEGMENT_SLOP = { top: TRACK_PADDING, bottom: TRACK_PADDING, left: 0, right: 0 };
/** Compact: a 36 dp track with 2 dp padding; each segment's touch area grows to 44. */
const COMPACT_PADDING = spacing.xxs;
const COMPACT_SLOP_Y = (hitTarget.min - sizes.segmentedCompact) / 2 + COMPACT_PADDING;
const COMPACT_SLOP = { top: COMPACT_SLOP_Y, bottom: COMPACT_SLOP_Y, left: 0, right: 0 };

/**
 * A row of equal-width segments on a 48 dp #F5F5F5 track (radius 8; MASTER §3
 * status tabs); the selected one is the white tab with dark semibold text. Labels
 * truncate instead of overflowing.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  size = 'md',
  accessibilityLabel,
  style,
  testID,
}: SegmentedControlProps<T>) {
  const compact = size === 'compact';
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, compact && styles.trackCompact, disabled && styles.disabled, style]}
      testID={testID}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const textColor = selected ? colors.text : colors.textSecondary;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            hitSlop={compact ? COMPACT_SLOP : SEGMENT_SLOP}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            testID={option.testID}
            style={({ pressed }) => [styles.segment, compact && styles.segmentCompact, selected ? styles.selected : pressed && styles.segmentPressed]}
          >
            {option.icon ? <Icon name={option.icon} size={iconSizes.sm} color={textColor} /> : null}
            <Text style={[selected ? styles.labelSelected : styles.label, { color: textColor }]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    minHeight: sizes.segmentedHeight,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: TRACK_PADDING,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: sizes.segmentedHeight - 2 * TRACK_PADDING,
    borderRadius: radius.inner,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  trackCompact: {
    minHeight: sizes.segmentedCompact,
    padding: COMPACT_PADDING,
    borderRadius: radius.inner,
  },
  segmentCompact: {
    minHeight: sizes.segmentedCompact - 2 * COMPACT_PADDING,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + spacing.xxs,
  },
  segmentPressed: {
    backgroundColor: colors.surfacePressed,
  },
  selected: {
    backgroundColor: colors.surface,
    ...shadows.segment,
  },
  label: {
    ...typography.control,
    flexShrink: 1,
  },
  labelSelected: {
    ...typography.controlStrong,
    flexShrink: 1,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
