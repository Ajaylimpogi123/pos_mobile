import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { colors, hitTarget, iconSizes, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';

type CheckboxRowProps = {
  label: string;
  /** Muted helper line under the label. */
  description?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Extra content on the right (e.g. an amount or a chip). */
  trailing?: ReactNode;
  testID?: string;
};

/**
 * A tappable row with a checkbox (a square that fills green with a check),
 * a label and an optional description; at least 48 high, soft green when
 * ticked, with pressed and disabled states. Announced as a checkbox.
 */
export function CheckboxRow({ label, description, checked, onToggle, disabled = false, trailing, testID }: CheckboxRowProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        checked && styles.rowChecked,
        pressed && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
      testID={testID}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Icon name="checkmark" size={iconSizes.sm} color={colors.onPrimary} /> : null}
      </View>
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: hitTarget.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  rowChecked: {
    backgroundColor: colors.primarySoft,
  },
  rowPressed: {
    backgroundColor: colors.surfacePressed,
    transform: [{ scale: pressedScale }],
  },
  rowDisabled: {
    opacity: opacity.disabled,
  },
  box: {
    width: sizes.checkbox,
    height: sizes.checkbox,
    borderRadius: radius.sm,
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  description: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
