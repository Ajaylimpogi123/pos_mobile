import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { colors, numeric, pressedScale, radius, spacing, typography } from '@/constants/theme';
import type { LocalOrderRecord } from '@/db/offlineRepository';
import { orderNumberLabel, ticketNumberLabel } from '@/sale/localOrder';
import { formatBusinessDate, formatClockTime } from '@/utils/dates';
import { formatPeso } from '@/utils/money';

type SyncQueueCardProps = {
  record: LocalOrderRecord;
  retrying: boolean;
  onRetry: (ulid: string) => void;
  onOpen: (ulid: string) => void;
};

/**
 * One sale saved on this tablet: its `order_no`, the kitchen's number, when
 * and by whom, the total in bold green, and its state: **Pending** (waiting to
 * be sent) or **Needs attention** with the server's message and **Retry**.
 * Tapping it opens the sale (read from the local order, with Reprint).
 */
export const SyncQueueCard = memo(function SyncQueueCard({ record, retrying, onRetry, onOpen }: SyncQueueCardProps) {
  const { order } = record;
  const testID = `sync-item-${record.ulid}`;
  const attention = record.status === 'needs_attention';
  const time = formatClockTime(order.placed_at) ?? '';
  const number = record.orderNo ?? orderNumberLabel(order);

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${number}, ${formatPeso(order.total_cents)}, ${attention ? 'needs attention' : 'pending'}`}
        accessibilityHint="Opens the sale"
        onPress={() => onOpen(record.ulid)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.top}>
          <View style={styles.number}>
            <Text style={[styles.numberText, styles.numberTextTabular]} numberOfLines={1}>
              {ticketNumberLabel(order)}
            </Text>
          </View>
          <View style={styles.titles}>
            <Text style={styles.orderNo} numberOfLines={1}>
              {number}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {formatBusinessDate(record.businessDate)} · {time} · {order.cashier.name}
            </Text>
          </View>
          <Text style={styles.total} numberOfLines={1}>
            {formatPeso(order.total_cents)}
          </Text>
        </View>
        <Chip
          label={attention ? 'Needs attention' : 'Pending'}
          variant={attention ? 'cancelled' : 'pending'}
          icon={attention ? 'alert-circle-outline' : 'cloud-upload-outline'}
          testID={`${testID}-status`}
        />
        {attention && record.lastError ? (
          <Text style={styles.error} testID={`${testID}-error`}>
            {record.lastError}
          </Text>
        ) : null}
      </Pressable>
      {attention ? (
        <Button
          title="Retry"
          leftIcon="refresh"
          variant="tonal"
          onPress={() => onRetry(record.ulid)}
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
  number: {
    minWidth: spacing.giant,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  numberText: {
    ...typography.heading,
    color: colors.primaryDark,
  },
  titles: {
    flex: 1,
    gap: spacing.xxs,
  },
  orderNo: {
    ...typography.bodyStrong,
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
  numberTextTabular: {
    ...numeric,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
