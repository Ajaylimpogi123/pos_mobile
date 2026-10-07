import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, iconSizes, radius, sizes, spacing, typography } from '@/constants/theme';

type PickerFieldProps = {
  label: string;
  /** The chosen value's text, or `''` for none. */
  value: string;
  placeholder: string;
  icon: IconName;
  onPress: () => void;
  error?: string | null;
  disabled?: boolean;
  /** e.g. "Opens the list of categories". */
  accessibilityHint?: string;
  testID: string;
};

/**
 * A field that looks exactly like an `Input` (52 dp, white, hairline border,
 * radius 12, label above, error below) and opens a picker (a supplier, an
 * item, a category…). Pressed: a soft grey-green fill; error: a 2 px red border.
 */
export function PickerField({ label, value, placeholder, icon, onPress, error, disabled = false, accessibilityHint, testID }: PickerFieldProps) {
  const hasError = Boolean(error);
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${value}` : `${label}, not chosen`}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.field, hasError && styles.fieldError, pressed && styles.fieldPressed, disabled && styles.fieldDisabled]}
        testID={testID}
      >
        <Icon name={icon} size={iconSizes.md} color={hasError ? colors.danger : colors.textSecondary} />
        <Text style={[styles.value, !value && styles.placeholder, disabled && styles.valueDisabled]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Icon name="chevron-down" size={iconSizes.md} color={colors.textSecondary} />
      </Pressable>
      {hasError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Horizontal padding inside the field; a 2 px error border takes 1 px of it so the text never shifts (as in `Input`). */
const PAD_X = spacing.md + spacing.xxs;

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xxs,
    minHeight: sizes.inputHeight,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: PAD_X,
  },
  fieldError: {
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.danger,
    paddingHorizontal: PAD_X - 1,
  },
  fieldPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  fieldDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  value: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  valueDisabled: {
    color: colors.textSecondary,
  },
  placeholder: {
    color: colors.textMuted,
  },
  error: {
    ...typography.captionStrong,
    color: colors.danger,
  },
});
