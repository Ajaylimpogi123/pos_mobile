import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Chip, type ChipVariant } from '@/components/ui/Chip';
import { colors, numeric, pressedScale, radius, spacing, typography } from '@/constants/theme';
import { varianceWord } from '@/printing/documents/shiftRead';
import type { Shift } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime, formatBranchTime } from '@/utils/businessDay';
import { formatPeso } from '@/utils/money';

type ShiftCardProps = {
  shift: Shift;
  /** Stable handler (it receives the shift), so the memoized card only re-renders when its data changes. */
  onPress: (shift: Shift) => void;
};

const FLAG_LABELS: Record<string, string> = {
  auto_closed: 'Closed automatically',
  movement_after_close: 'Cash moved after close',
};

/** A shift flag in plain words (a flag this build doesn't know shows as it is). */
export function shiftFlagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag;
}

/** "Short ₱50.00", "Over ₱20.00", "Balanced", or `null` (open, or closed without a count). */
export function varianceText(varianceCents: number | null): string | null {
  if (varianceCents === null) return null;
  return varianceCents === 0 ? 'Balanced' : `${varianceWord(varianceCents)} ${formatPeso(Math.abs(varianceCents))}`;
}

/** Short → cancelled (red), over → caution, balanced → completed (green). */
export function varianceVariant(varianceCents: number | null): ChipVariant {
  if (varianceCents === null || varianceCents === 0) return 'completed';
  return varianceCents < 0 ? 'cancelled' : 'caution';
}

/**
 * One shift in the Shifts list: the tablet, open or closed (and any flags),
 * when and by whom, net sales in bold green, and the variance once closed.
 */
export const ShiftCard = memo(function ShiftCard({ shift, onPress }: ShiftCardProps) {
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const opened = formatBranchDateTime(shift.opened_at, timeZone) ?? shift.opened_at;
  const closed = shift.closed_at ? formatBranchTime(shift.closed_at, timeZone) : null;
  const variance = varianceText(shift.report.variance_cents);
  const testID = `shift-card-${shift.ulid}`;

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Shift on ${shift.device.code}, opened ${opened}, ${shift.status}, net sales ${formatPeso(shift.report.net_sales_cents)}`}
        accessibilityHint="Opens the shift report"
        onPress={() => onPress(shift)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.top}>
          <View style={styles.device}>
            <Text style={styles.deviceText} numberOfLines={1}>
              {shift.device.code}
            </Text>
          </View>
          <View style={styles.titles}>
            <Text style={styles.title} numberOfLines={2}>
              {closed ? `${opened} – ${closed}` : `Since ${opened}`}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              Opened by {shift.opened_by.name}
              {shift.closed_by ? ` · Closed by ${shift.closed_by.name}` : ''}
            </Text>
          </View>
          <Text style={styles.total} numberOfLines={1} testID={`${testID}-net`}>
            {formatPeso(shift.report.net_sales_cents)}
          </Text>
        </View>
        <View style={styles.chips}>
          <Chip
            label={shift.status === 'open' ? 'Open' : 'Closed'}
            variant={shift.status === 'open' ? 'processing' : 'completed'}
            icon={shift.status === 'open' ? 'time-outline' : 'lock-closed-outline'}
            testID={`${testID}-status`}
          />
          {variance ? <Chip label={variance} variant={varianceVariant(shift.report.variance_cents)} testID={`${testID}-variance`} /> : null}
          {(shift.report.voids_count ?? 0) > 0 ? (
            <Chip
              label={`${shift.report.voids_count} voided`}
              variant="cancelled"
              icon="close-circle-outline"
              testID={`${testID}-voids`}
            />
          ) : null}
          {(shift.report.refunds_cents ?? 0) > 0 ? (
            <Chip
              label={`Refunds ${formatPeso(shift.report.refunds_cents)}`}
              variant="pending"
              icon="return-down-back-outline"
              testID={`${testID}-refunds`}
            />
          ) : null}
          {shift.flags.map((flag) => (
            <Chip key={flag} label={shiftFlagLabel(flag)} variant="caution" icon="flag-outline" />
          ))}
        </View>
      </Pressable>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
  },
  body: {
    gap: spacing.md,
    borderRadius: radius.md,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  device: {
    minWidth: spacing.giant,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  deviceText: {
    ...typography.heading,
    color: colors.primaryDark,
  },
  titles: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  total: {
    ...typography.price,
    color: colors.primary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
