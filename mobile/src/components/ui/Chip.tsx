import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, radius, sizes, spacing, status, typography, type StatusKey } from '@/constants/theme';

/**
 * Badges (MASTER §1.3 / §3 / §6): 24 high, radius 6, a 1 px border, 12 / 600.
 * - Status variants (`completed`, `pending`, `processing`, `cancelled`,
 *   `caution`) show a **state**: the 6 px dot **and** the word, in the status
 *   colour on its tint with its border. The dot is never replaced by an icon;
 *   a `bar` badge may add its icon after the dot.
 *   The older names stay as aliases: `success` → completed, `danger` →
 *   cancelled, `info` → processing, `warning` → caution.
 * - `neutral` and `primary` are **tags** (not a state: SC/PWD, stock mode,
 *   a role): a neutral outline badge with no dot and no status tint.
 */
export type ChipVariant = 'neutral' | 'primary' | StatusKey | 'success' | 'danger' | 'warning' | 'info';

type ChipProps = {
  label: string;
  variant?: ChipVariant;
  /** Tags: an icon before the word. Status badges: shown only in `bar` size (after the dot) and `iconOnly`. */
  icon?: IconName;
  /** `sm`: a 24 high badge. `bar`: a header status badge (28 high; wrap it in a Pressable with `STATUS_CHIP_HIT_SLOP`). */
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

/** Grows a header status badge's touch area to 48 (MASTER §6). */
const barSlop = (hitTarget.primary - sizes.statusChipHeight) / 2;
export const STATUS_CHIP_HIT_SLOP = { top: barSlop, bottom: barSlop, left: barSlop, right: barSlop };

type Look = { background: string; border: string; text: string; icon: string; dot: boolean };

const statusLook = (key: StatusKey): Look => ({
  background: status[key].tint,
  border: status[key].border,
  text: status[key].color,
  icon: status[key].color,
  dot: true,
});

const tagLook: Look = { background: colors.surface, border: colors.border, text: colors.text, icon: colors.textSecondary, dot: false };

const looks: Record<ChipVariant, Look> = {
  neutral: tagLook,
  primary: tagLook,
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

/** Small read-only badge: a status (dot + word), a tag, or a header status badge. */
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

  const dot = look.dot && !onlyIcon ? <View style={[styles.dot, { backgroundColor: look.icon }]} /> : null;
  // A tag may carry an icon; a status badge keeps its dot and adds the icon only in the header (or icon-only) form.
  const showIcon = icon !== undefined && (!look.dot || bar || onlyIcon);
  const glyph = showIcon ? <Icon name={icon} size={iconSizes.sm} color={look.icon} /> : null;

  return (
    <View
      style={[styles.chip, bar && styles.chipBar, onlyIcon && styles.chipIconOnly, { backgroundColor: look.background, borderColor: look.border }]}
      accessible={onlyIcon || accessibilityLabel !== undefined || undefined}
      accessibilityLabel={accessibilityLabel ?? (onlyIcon ? label : undefined)}
      testID={testID}
    >
      {dot}
      {glyph}
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
    borderRadius: radius.sm,
    borderWidth: sizes.borderWidth,
    paddingVertical: spacing.none,
    paddingHorizontal: spacing.sm,
  },
  chipBar: {
    alignSelf: 'center',
    height: sizes.statusChipHeight,
    gap: spacing.xs + spacing.xxs,
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
