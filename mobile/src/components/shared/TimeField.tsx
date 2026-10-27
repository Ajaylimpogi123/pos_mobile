import { StyleSheet, Text, View } from 'react-native';

import { IconButton } from '@/components/ui/IconButton';
import { colors, numeric, radius, sizes, spacing, typography } from '@/constants/theme';
import { formatTimeOfDay, minutesOfDay, TIME_STEP_MINUTES, timeOfDay } from '@/hooks/tables/reservationTime';

type TimeFieldProps = {
  label: string;
  /** `HH:MM`, 24 h. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
  testID: string;
};

/**
 * A time of day without a native picker (the companion of `DateField`):
 * « » move an hour, ‹ › a quarter hour; the value reads "7:00 PM".
 */
export function TimeField({ label, value, onChange, error, disabled = false, testID }: TimeFieldProps) {
  const minutes = minutesOfDay(value) ?? 0;
  const step = (delta: number) => onChange(timeOfDay(minutes + delta));

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <IconButton icon="play-back" variant="soft" accessibilityLabel={`${label}: an hour earlier`} onPress={() => step(-60)} disabled={disabled} testID={`${testID}-hour-earlier`} />
        <IconButton
          icon="chevron-back"
          variant="soft"
          accessibilityLabel={`${label}: ${TIME_STEP_MINUTES} minutes earlier`}
          onPress={() => step(-TIME_STEP_MINUTES)}
          disabled={disabled}
          testID={`${testID}-earlier`}
        />
        <Text style={styles.value} numberOfLines={1} accessibilityLiveRegion="polite" testID={testID}>
          {formatTimeOfDay(value)}
        </Text>
        <IconButton
          icon="chevron-forward"
          variant="soft"
          accessibilityLabel={`${label}: ${TIME_STEP_MINUTES} minutes later`}
          onPress={() => step(TIME_STEP_MINUTES)}
          disabled={disabled}
          testID={`${testID}-later`}
        />
        <IconButton icon="play-forward" variant="soft" accessibilityLabel={`${label}: an hour later`} onPress={() => step(60)} disabled={disabled} testID={`${testID}-hour-later`} />
      </View>
      {error ? (
        <Text style={styles.error} testID={`${testID}-error`}>
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
  label: {
    ...typography.label,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.inputHeight,
    borderRadius: radius.md,
  },
  value: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
