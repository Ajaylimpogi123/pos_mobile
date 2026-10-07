import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors, hitTarget, opacity, spacing, typography } from '@/constants/theme';

type SwitchRowProps = {
  label: string;
  /** Muted helper line under the label. */
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  error?: string | null;
  testID?: string;
};

/** Label (+ description) with a themed Switch on the right; the row is at least 48 high. */
export function SwitchRow({ label, description, value, onValueChange, disabled = false, error, testID }: SwitchRowProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.row, disabled && styles.disabled]}>
        <View style={styles.text}>
          <Text style={styles.label}>{label}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          accessibilityLabel={label}
          accessibilityHint={description}
          trackColor={{ false: colors.borderStrong, true: colors.primaryBright }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.borderStrong}
          testID={testID}
        />
      </View>
      {error ? (
        <Text style={styles.error} testID={testID ? `${testID}-error` : undefined} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: hitTarget.primary,
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
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
