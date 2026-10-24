import { Children, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, type ChipVariant } from '@/components/ui/Chip';
import { colors, hitTarget, numeric, spacing, typography } from '@/constants/theme';
import type { CheckState } from '@/hooks/device/useThisTablet';
import type { DeviceHealth } from '@/services/types';
import { DEVICE_HEALTH_LABELS, deviceHealthTone, type HealthTone } from '@pos/core/errors/health';

/** A shared tone → chip variant (badges are a dot plus a word). */
export function toneVariant(tone: HealthTone): ChipVariant {
  return tone;
}

/** The health chip of a device (`@pos/core/errors/health` wording). */
export function HealthChip({ health, testID }: { health: DeviceHealth; testID?: string }) {
  return (
    <Chip
      label={DEVICE_HEALTH_LABELS[health]}
      variant={toneVariant(deviceHealthTone(health))}
      size="sm"
      accessibilityLabel={`Health: ${DEVICE_HEALTH_LABELS[health]}`}
      testID={testID}
    />
  );
}

/** Each checklist state as a status badge (MASTER §1.3: the dot and the word). */
const CHECK_LOOK: Record<CheckState, { variant: ChipVariant; word: string }> = {
  ok: { variant: 'completed', word: 'OK' },
  warn: { variant: 'caution', word: 'Check' },
  fail: { variant: 'cancelled', word: 'Problem' },
};

/** One checklist line: the label and its fix hint on the left, the status badge (OK / Check / Problem) on the right. */
export function CheckRow({ label, state, hint, testID }: { label: string; state: CheckState; hint: string; testID?: string }) {
  const look = CHECK_LOOK[state];
  return (
    <View style={styles.checkRow} accessible accessibilityLabel={`${label}: ${look.word}. ${hint}`} testID={testID}>
      <View style={styles.checkText}>
        <Text style={styles.checkLabel}>{label}</Text>
        <Text style={styles.checkHint} testID={testID ? `${testID}-hint` : undefined}>
          {hint}
        </Text>
      </View>
      <Chip label={look.word} variant={look.variant} testID={testID ? `${testID}-status` : undefined} />
    </View>
  );
}

/** A label on the left, its value on the right (wraps on narrow cards). */
export function ValueRow({ label, value, testID }: { label: string; value: ReactNode; testID?: string }) {
  return (
    <View style={styles.valueRow}>
      <Text style={styles.valueLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={styles.value} testID={testID}>
          {value}
        </Text>
      ) : (
        <View style={styles.valueSlot} testID={testID}>
          {value}
        </View>
      )}
    </View>
  );
}

/** Groups labelled rows (checklist lines, `ValueRow`s) with a hairline between them. */
export function RowList({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View testID={testID}>
      {Children.toArray(children).map((child, index) => (
        <View key={index} style={index > 0 ? styles.divided : null}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** A row of buttons under a section (wraps on phones). */
export function ActionRow({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

const styles = StyleSheet.create({
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: hitTarget.min,
    paddingVertical: spacing.sm,
  },
  checkText: {
    flex: 1,
    gap: spacing.xxs,
  },
  checkLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  checkHint: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  valueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: hitTarget.min,
    paddingVertical: spacing.sm,
  },
  valueLabel: {
    ...typography.bodySm,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  value: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  valueSlot: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
