import { memo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, iconSizes, numeric, opacity, radius, sizes, spacing, typography } from '@/constants/theme';

/** The icon tile's resting tone: `neutral` (page-grey tile, dark icon) or `primary` (soft-green tile, green icon). */
export type ListRowTone = 'neutral' | 'primary';

type ListRowProps = {
  label: string;
  onPress: () => void;
  icon?: IconName;
  tone?: ListRowTone;
  /** A short value on the right, before the chevron (e.g. "3 printers"). */
  value?: string;
  /** A secondary line under the label (e.g. why the row is disabled). */
  subLabel?: string | null;
  /** Shows the trailing chevron (default true). */
  chevron?: boolean;
  /** Red label and icon tile (e.g. Sign out, Close shift). */
  danger?: boolean;
  /** The selected row (e.g. the section in the settings pane): soft fill, emerald text. */
  selected?: boolean;
  disabled?: boolean;
  /** A hairline divider under the row. */
  divider?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type Tint = { tile: string; icon: string; text: string; chevron: string };

const TINTS: Record<ListRowTone | 'danger' | 'selected', Tint> = {
  neutral: { tile: colors.background, icon: colors.textResting, text: colors.text, chevron: colors.textSecondary },
  primary: { tile: colors.primarySoft, icon: colors.primary, text: colors.text, chevron: colors.textSecondary },
  danger: { tile: colors.dangerSoft, icon: colors.danger, text: colors.dangerText, chevron: colors.textSecondary },
  selected: { tile: colors.surface, icon: colors.primary, text: colors.primaryDark, chevron: colors.primary },
};

/**
 * A 56 dp navigation / menu row: a soft icon tile, the label (with an
 * optional sub-line), an optional value and a chevron. Pressed, selected,
 * disabled and danger states. Memoised: pass a stable `onPress` in lists.
 */
export const ListRow = memo(function ListRow({
  label,
  onPress,
  icon,
  tone = 'neutral',
  value,
  subLabel,
  chevron = true,
  danger = false,
  selected = false,
  disabled = false,
  divider = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ListRowProps) {
  let tint = TINTS[tone];
  if (danger) tint = TINTS.danger;
  else if (selected) tint = TINTS.selected;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divider && styles.divider,
        selected && styles.selected,
        pressed && (selected ? styles.selectedPressed : styles.pressed),
        disabled && styles.disabled,
        style,
      ]}
      testID={testID}
    >
      {icon ? (
        <View style={[styles.tile, { backgroundColor: tint.tile }]}>
          <Icon name={icon} size={iconSizes.md} color={tint.icon} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text style={[selected ? styles.labelSelected : styles.label, { color: tint.text }]} numberOfLines={1}>
          {label}
        </Text>
        {subLabel ? <Text style={styles.subLabel}>{subLabel}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {chevron ? <Icon name="chevron-forward" size={iconSizes.sm} color={tint.chevron} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.listRow,
    paddingHorizontal: spacing.md + spacing.xxs,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.divider,
  },
  selected: {
    backgroundColor: colors.selectedRow,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  selectedPressed: {
    backgroundColor: colors.primarySoft,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  tile: {
    width: sizes.badge.md,
    height: sizes.badge.md,
    borderRadius: radius.inner,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  label: {
    ...typography.control,
  },
  labelSelected: {
    ...typography.controlStrong,
  },
  subLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  value: {
    ...typography.bodySm,
    ...numeric,
    color: colors.textSecondary,
    flexShrink: 1,
  },
});
