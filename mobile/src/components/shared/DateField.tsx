import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';
import { useSessionStore } from '@/stores/session';
import { addBusinessDays, businessDateAt } from '@/utils/businessDay';
import { formatBusinessDate } from '@/utils/dates';

type DateFieldProps = {
  label: string;
  /** `YYYY-MM-DD`, or `null` for none. */
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string | null;
  disabled?: boolean;
  testID: string;
};

/**
 * An optional date (`YYYY-MM-DD`) without a native picker: **Set date**
 * starts at the branch's today, ‹ › move a day, **Clear** removes it.
 */
export function DateField({ label, value, onChange, error, disabled = false, testID }: DateFieldProps) {
  const branch = useSessionStore((state) => state.user?.branch);

  function today(): string {
    return businessDateAt(Date.now(), branch?.timezone ?? '', branch?.day_start_time ?? '00:00');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      {value === null ? (
        <Button title="Set date" leftIcon="calendar-outline" variant="secondary" onPress={() => onChange(today())} disabled={disabled} testID={`${testID}-set`} />
      ) : (
        <View style={styles.row}>
          <IconButton icon="chevron-back" variant="soft" accessibilityLabel={`${label}: a day earlier`} onPress={() => onChange(addBusinessDays(value, -1))} disabled={disabled} testID={`${testID}-earlier`} />
          <Text style={styles.value} numberOfLines={1} accessibilityLiveRegion="polite" testID={testID}>
            {formatBusinessDate(value)}
          </Text>
          <IconButton icon="chevron-forward" variant="soft" accessibilityLabel={`${label}: a day later`} onPress={() => onChange(addBusinessDays(value, 1))} disabled={disabled} testID={`${testID}-later`} />
          <IconButton icon="close" variant="ghost" accessibilityLabel={`Clear ${label}`} onPress={() => onChange(null)} disabled={disabled} testID={`${testID}-clear`} />
        </View>
      )}
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
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
