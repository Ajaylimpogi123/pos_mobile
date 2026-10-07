import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, type ChipVariant } from '@/components/ui/Chip';
import { CellText, type DataTableColumn } from '@/components/ui/DataTable';
import type { IconName } from '@/components/ui/Icon';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { LocalOrderBadge, LocalOrderSummary } from '@/hooks/orders/useLocalOrders';
import type { OrderListEntry } from '@/hooks/orders/useOrders';
import { orderNumberLabel, ticketNumberLabel } from '@/sale/localOrder';
import { paymentMethodLabel } from '@/sale/payments';
import { orderStatusLabel } from '@/sale/reversals';
import type { OrderStatus } from '@/services/types';
import { formatBusinessDate, formatClockTime } from '@/utils/dates';
import { formatPeso } from '@/utils/money';
import { formatCount, NO_VALUE } from '@/utils/numbers';

/** Offline Sales: a local sale that hasn't synced (`pending`) or that the server rejected. */
export const ORDER_BADGES: Record<LocalOrderBadge, { label: string; variant: 'pending' | 'cancelled'; icon: IconName }> = {
  pending: { label: 'Not synced yet', variant: 'pending', icon: 'cloud-upload-outline' },
  needs_attention: { label: 'Needs attention', variant: 'cancelled', icon: 'alert-circle-outline' },
};

const STATUS_VARIANT: Record<OrderStatus, ChipVariant> = {
  completed: 'completed',
  voided: 'cancelled',
  refunded: 'pending',
  partially_refunded: 'pending',
};

type StatusChip = { key: string; label: string; variant: ChipVariant; testSuffix: string };

/**
 * The status chips of an order row: the sync badge of a local sale, or
 * "Needs review" for a flagged one; then the order's status (Completed,
 * Voided, Refunded / Partly refunded with the amount); then `SC/PWD`.
 */
export function orderStatusChips(order: LocalOrderSummary, badge?: LocalOrderBadge): StatusChip[] {
  const chips: StatusChip[] = [];
  if (badge) {
    const look = ORDER_BADGES[badge];
    chips.push({ key: 'badge', label: look.label, variant: look.variant, testSuffix: 'badge' });
  } else if (order.needs_review) {
    chips.push({ key: 'review', label: 'Needs review', variant: 'caution', testSuffix: 'needs-review' });
  }
  if (!badge) {
    const refunded = order.status === 'refunded' || order.status === 'partially_refunded';
    const label =
      refunded && order.refunded_cents > 0 ? `${orderStatusLabel(order.status)} · ${formatPeso(order.refunded_cents)}` : orderStatusLabel(order.status);
    chips.push({ key: 'status', label, variant: STATUS_VARIANT[order.status] ?? 'neutral', testSuffix: 'status' });
  }
  if (order.has_sc_pwd) chips.push({ key: 'sc-pwd', label: 'SC/PWD', variant: 'info', testSuffix: 'sc-pwd' });
  return chips;
}

/** What a screen reader says for an order row or card. */
export function orderAccessibilityLabel(order: LocalOrderSummary, showDate: boolean, badge?: LocalOrderBadge): string {
  const time = formatClockTime(order.placed_at) ?? '';
  const when = showDate ? `${formatBusinessDate(order.business_date)} · ${time}` : time;
  const look = badge ? ORDER_BADGES[badge] : null;
  return `${orderNumberLabel(order)}, queue ${ticketNumberLabel(order)}${order.table_no ? `, table ${order.table_no}` : ''}, ${formatPeso(order.total_cents)}, ${when}${
    look ? `, ${look.label}` : ''
  }${order.status !== 'completed' ? `, ${orderStatusLabel(order.status)}` : ''}`;
}

function testIDOf(entry: OrderListEntry): string {
  return `order-card-${entry.order.ulid}`;
}

export const orderRowTestID = testIDOf;

function itemsLabel(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'item' : 'items'}`;
}

/**
 * The Orders table's columns (Sage "Orders" board). Tablet landscape: order
 * (queue, invoice, cashier and items), time, table, customer, payment, total
 * and status. Tablet portrait drops time and customer (the time moves under
 * the invoice). Test IDs keep the card names (`order-card-<ulid>-total`, …).
 */
export function useOrderColumns({ showDate, wide }: { showDate: boolean; wide: boolean }): DataTableColumn<OrderListEntry>[] {
  return useMemo(() => {
    const order: DataTableColumn<OrderListEntry> = {
      key: 'order',
      header: 'Order',
      flex: wide ? 1.5 : 1.8,
      render: ({ order: item }) => {
        const time = formatClockTime(item.placed_at) ?? '';
        const meta = [item.cashier.name, itemsLabel(item.items_count)];
        if (!wide) meta.push(showDate ? `${formatBusinessDate(item.business_date)} ${time}` : time);
        return (
          <View style={styles.orderCell}>
            <View style={styles.queue}>
              <Text style={styles.queueText} numberOfLines={1}>
                {ticketNumberLabel(item)}
              </Text>
            </View>
            <View style={styles.orderText}>
              <CellText variant="strong">{orderNumberLabel(item)}</CellText>
              <CellText variant="muted">{meta.join(' · ')}</CellText>
            </View>
          </View>
        );
      },
    };
    const time: DataTableColumn<OrderListEntry> = {
      key: 'time',
      header: 'Time',
      flex: 0.9,
      render: ({ order: item }) => (
        <>
          {showDate ? <CellText variant="muted">{formatBusinessDate(item.business_date)}</CellText> : null}
          <CellText>{formatClockTime(item.placed_at) ?? NO_VALUE}</CellText>
        </>
      ),
    };
    const table: DataTableColumn<OrderListEntry> = {
      key: 'table',
      header: 'Table',
      flex: 0.8,
      render: (entry) =>
        entry.order.table_no ? (
          <View style={styles.tablePill}>
            <Text style={styles.tableText} numberOfLines={1} testID={`${testIDOf(entry)}-table`}>
              {`Table ${entry.order.table_no}`}
            </Text>
          </View>
        ) : (
          <CellText variant="muted">{NO_VALUE}</CellText>
        ),
    };
    const customer: DataTableColumn<OrderListEntry> = {
      key: 'customer',
      header: 'Customer',
      flex: 1.1,
      render: (entry) =>
        entry.order.customer ? (
          <CellText testID={`${testIDOf(entry)}-customer`}>{entry.order.customer.full_name}</CellText>
        ) : (
          <CellText variant="muted">Walk-in</CellText>
        ),
    };
    const payment: DataTableColumn<OrderListEntry> = {
      key: 'payment',
      header: 'Payment',
      flex: 0.9,
      render: (entry) => (
        <CellText>
          {entry.order.payment_methods.length === 0
            ? NO_VALUE
            : entry.order.payment_methods.map((method, index) => (
                <Text key={method} testID={`${testIDOf(entry)}-${method}`}>
                  {index > 0 ? ' · ' : ''}
                  {paymentMethodLabel(method)}
                </Text>
              ))}
        </CellText>
      ),
    };
    const total: DataTableColumn<OrderListEntry> = {
      key: 'total',
      header: 'Total',
      flex: 0.9,
      align: 'right',
      render: (entry) => (
        <CellText variant="strong" align="right" testID={`${testIDOf(entry)}-total`}>
          {formatPeso(entry.order.total_cents)}
        </CellText>
      ),
    };
    const status: DataTableColumn<OrderListEntry> = {
      key: 'status',
      header: 'Status',
      flex: 1.5,
      render: (entry) => (
        <View style={styles.chips}>
          {orderStatusChips(entry.order, entry.kind === 'local' ? entry.badge : undefined).map((chip) => (
            <Chip key={chip.key} label={chip.label} variant={chip.variant} testID={`${testIDOf(entry)}-${chip.testSuffix}`} />
          ))}
        </View>
      ),
    };
    return wide ? [order, time, table, customer, payment, total, status] : [order, table, payment, total, status];
  }, [showDate, wide]);
}

const styles = StyleSheet.create({
  orderCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
  },
  queue: {
    minWidth: spacing.xxxl + spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm - spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  queueText: {
    ...typography.controlStrong,
    color: colors.primaryDark,
  },
  orderText: {
    flexShrink: 1,
  },
  tablePill: {
    maxWidth: '100%',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  tableText: {
    ...typography.label,
    color: colors.textResting,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: '100%',
    overflow: 'hidden',
  },
});
