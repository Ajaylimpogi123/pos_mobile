import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { IconBadge } from '@/components/ui/IconBadge';
import type { IconName } from '@/components/ui/Icon';
import { colors, spacing, typography } from '@/constants/theme';
import type { ShiftEventRecord } from '@/db/offlineRepository';
import type { CashMovementRequest, ShiftCloseRequest, ShiftOpenRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatPeso } from '@/utils/money';

type ShiftEventCardProps = {
  event: ShiftEventRecord;
  retrying: boolean;
  onRetry: (ulid: string) => void;
};

type Described = { title: string; detail: string; icon: IconName; at: string };

/** "Shift opened · Starting cash ₱2,000.00", "Cash in ₱500.00 · Change fund", "Shift closed · Counted ₱8,450.00". */
export function describeShiftEvent(event: ShiftEventRecord): Described {
  switch (event.entity) {
    case 'shift_open': {
      const body = event.body as ShiftOpenRequest;
      return { title: 'Shift opened', detail: `Starting cash ${formatPeso(body.opening_float_cents)}`, icon: 'play-circle-outline', at: body.opened_at };
    }
    case 'cash_movement': {
      const body = event.body as CashMovementRequest;
      return {
        title: `${body.type === 'in' ? 'Cash in' : 'Cash out'} ${formatPeso(body.amount_cents)}`,
        detail: body.reason,
        icon: body.type === 'in' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline',
        at: body.occurred_at,
      };
    }
    default: {
      const body = event.body as ShiftCloseRequest;
      return { title: 'Shift closed', detail: `Counted cash ${formatPeso(body.counted_cash_cents)}`, icon: 'lock-closed-outline', at: body.closed_at };
    }
  }
}

/**
 * One shift event saved on this tablet (Phase 6): opening, cash in / out or
 * closing, still **Pending**, or **Needs attention** with the server's
 * message and **Retry** (it is never deleted).
 */
export const ShiftEventCard = memo(function ShiftEventCard({ event, retrying, onRetry }: ShiftEventCardProps) {
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const described = describeShiftEvent(event);
  const attention = event.status === 'needs_attention';
  const testID = `sync-shift-${event.ulid}`;

  return (
    <Card style={styles.card} testID={testID}>
      <View
        style={styles.top}
        accessible
        accessibilityLabel={`${described.title}, ${described.detail}, ${attention ? 'needs attention' : 'pending'}`}
      >
        <IconBadge icon={described.icon} tone={attention ? 'danger' : 'primary'} />
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={2}>
            {described.title}
          </Text>
          <Text style={styles.meta} numberOfLines={2}>
            {described.detail}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatBranchDateTime(described.at, timeZone) ?? described.at}
          </Text>
        </View>
      </View>
      <Chip
        label={attention ? 'Needs attention' : 'Pending'}
        variant={attention ? 'cancelled' : 'pending'}
        icon={attention ? 'alert-circle-outline' : 'cloud-upload-outline'}
        testID={`${testID}-status`}
      />
      {attention && event.lastError ? (
        <Text style={styles.error} testID={`${testID}-error`}>
          {event.lastError}
        </Text>
      ) : null}
      {attention ? (
        <Button
          title="Retry"
          leftIcon="refresh"
          variant="tonal"
          onPress={() => onRetry(event.ulid)}
          loading={retrying}
          disabled={retrying}
          testID={`${testID}-retry`}
        />
      ) : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    gap: spacing.md,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  titles: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
