import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, radius, sizes, spacing, status, typography, type StatusKey } from '@/constants/theme';

/**
 * Status variants (`completed`, `pending`, `processing`, `cancelled`,
 * `caution`) are a dot + a bold label in the exact status colour on its tint.
 * The older names stay as aliases: `success` → completed, `danger` →
 * cancelled, `info` → processing, `warning` → caution. `neutral` and
 * `primary` are plain tags (no dot).
 */
export type ChipVariant = 'neutral' | 'primary' | StatusKey | 'success' | 'danger' | 'warning' | 'info';

type ChipProps = {
  label: string;
  variant?: ChipVariant;
  /** Replaces the status dot with an icon in the same colour. */
  icon?: IconName;
  /** `sm`: a small tag (28 high). `bar`: a top-bar status chip (36 high; wrap it in a Pressable with `STATUS_CHIP_HIT_SLOP`). */
  size?: 'sm' | 'bar';
  /**
   * Show only the icon (e.g. top-bar status on phones in portrait). The label
   * stays the accessibility label, so the status is still announced.
   */
  iconOnly?: boolean;
  /** Makes the chip one accessible element with this label (e.g. "Status: Responding"). */
  accessibilityLabel?: string;
  testID?: string;
};

/** Grows a 36-high status chip's touch area to the 44 minimum. */
const barSlop = (hitTarget.min - sizes.statusChipHeight) / 2;
export const STATUS_CHIP_HIT_SLOP = { top: barSlop, bottom: barSlop, left: barSlop, right: barSlop };

type Look = { background: string; text: string; icon: string; dot: boolean };

const statusLook = (key: StatusKey): Look => ({
  background: status[key].tint,
  text: status[key].color,
  icon: status[key].color,
  dot: true,
});

const looks: Record<ChipVariant, Look> = {
  neutral: { background: colors.surfaceMuted, text: colors.textResting, icon: colors.textSecondary, dot: false },
  primary: { background: colors.primarySoft, text: colors.primaryDark, icon: colors.primary, dot: false },
  completed: statusLook('completed'),
  pending: statusLook('pending'),
  processing: statusLook('processing'),
  cancelled: statusLook('cancelled'),
  caution: statusLook('caution'),
  success: statusLook('completed'),
  danger: statusLook('cancelled'),
  info: statusLook('processing'),
  warning: statusLook('caution'),
};

/** Small read-only pill: a status, a role, a tag, or a top-bar status chip. */
export const Chip = memo(function Chip({
  label,
  variant = 'neutral',
  icon,
  size = 'sm',
  iconOnly = false,
  accessibilityLabel,
  testID,
}: ChipProps) {
  const look = looks[variant];
  const bar = size === 'bar';
  const onlyIcon = iconOnly && icon !== undefined;

  let marker = null;
  if (icon) marker = <Icon name={icon} size={bar ? iconSizes.md : iconSizes.sm} color={look.icon} />;
  else if (look.dot) marker = <View style={[styles.dot, { backgroundColor: look.icon }]} />;

  return (
    <View
      style={[styles.chip, bar && styles.chipBar, onlyIcon && styles.chipIconOnly, { backgroundColor: look.background }]}
      accessible={onlyIcon || accessibilityLabel !== undefined || undefined}
      accessibilityLabel={accessibilityLabel ?? (onlyIcon ? label : undefined)}
      testID={testID}
    >
      {marker}
      {onlyIcon ? null : (
        <Text style={[styles.label, { color: look.text }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + spacing.xxs,
    minHeight: sizes.chipMinHeight,
    maxWidth: '100%',
    borderRadius: radius.pill,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.md,
  },
  chipBar: {
    alignSelf: 'center',
    height: sizes.statusChipHeight,
    paddingVertical: spacing.none,
    gap: spacing.sm,
  },
  chipIconOnly: {
    width: sizes.statusChipHeight,
    paddingHorizontal: spacing.none,
    justifyContent: 'center',
  },
  dot: {
    width: sizes.chipDot,
    height: sizes.chipDot,
    borderRadius: radius.pill,
  },
  label: {
    ...typography.chip,
    flexShrink: 1,
  },
});
