import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { colors, pressedScale, radius, spacing, typography } from '@/constants/theme';
import type { LocalOrderBadge, LocalOrderSummary } from '@/hooks/orders/useLocalOrders';
import { orderNumberLabel, ticketNumberLabel } from '@/sale/localOrder';
import { paymentMethodLabel } from '@pos/core/sale/payments';
import { orderStatusLabel } from '@pos/core/sale/reversals';
import { formatBusinessDate, formatClockTime } from '@/utils/dates';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

type OrderCardProps = {
  /** An `OrderSummary` from the API, or the summary of a sale saved on this tablet (no invoice number yet). */
  order: LocalOrderSummary;
  /** Show the business date too (when the list spans several days). */
  showDate: boolean;
  /** Offline Sales: a local sale that hasn't synced (`pending`) or that the server rejected. */
  badge?: LocalOrderBadge;
  onPress: () => void;
};

const BADGES: Record<LocalOrderBadge, { label: string; variant: 'pending' | 'cancelled'; icon: 'cloud-upload-outline' | 'alert-circle-outline' }> = {
  pending: { label: 'Not synced yet', variant: 'pending', icon: 'cloud-upload-outline' },
  needs_attention: { label: 'Needs attention', variant: 'cancelled', icon: 'alert-circle-outline' },
};

/**
 * An order in the history: queue number, invoice number, time and cashier,
 * the total in bold green, then the customer, the item count and the payment
 * methods. Tap to open the receipt.
 *
 * Offline Sales (Phase 5): a sale saved on this tablet shows its `order_no`
 * (`T01-20260926-0005 (offline)`), the kitchen's number (`T01-5`) and a badge;
 * a synced sale flagged for review shows "Needs review". A sale with an
 * SC/PWD discount shows an `SC/PWD` badge.
 */
export function OrderCard({ order, showDate, badge, onPress }: OrderCardProps) {
  const testID = `order-card-${order.ulid}`;
  const time = formatClockTime(order.placed_at) ?? '';
  const when = showDate ? `${formatBusinessDate(order.business_date)} · ${time}` : time;
  const items = `${formatCount(order.items_count)} ${order.items_count === 1 ? 'item' : 'items'}`;
  const title = orderNumberLabel(order);
  const number = ticketNumberLabel(order);
  const look = badge ? BADGES[badge] : null;

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, queue ${number}${order.table_no ? `, table ${order.table_no}` : ''}, ${formatPeso(order.total_cents)}, ${when}${look ? `, ${look.label}` : ''}${order.status !== 'completed' ? `, ${orderStatusLabel(order.status)}` : ''}`}
        accessibilityHint="Opens the receipt"
        onPress={onPress}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.top}>
          <View style={styles.queue}>
            <Text style={styles.queueText} numberOfLines={1}>
              {number}
            </Text>
          </View>
          {order.table_no ? (
            <View style={styles.queue} testID={`${testID}-table`}>
              <Text style={styles.queueText} numberOfLines={1}>
                Table {order.table_no}
              </Text>
            </View>
          ) : null}
          <View style={styles.titles}>
            <Text style={styles.invoice} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {when} · {order.cashier.name}
            </Text>
          </View>
          <Text style={styles.total} numberOfLines={1} testID={`${testID}-total`}>
            {formatPeso(order.total_cents)}
          </Text>
        </View>
        <View style={styles.chips}>
          {look ? <Chip label={look.label} variant={look.variant} icon={look.icon} testID={`${testID}-badge`} /> : null}
          {!look && order.needs_review ? (
            <Chip label="Needs review" variant="caution" icon="flag-outline" testID={`${testID}-needs-review`} />
          ) : null}
          {order.status === 'voided' ? (
            <Chip label={orderStatusLabel(order.status)} variant="cancelled" icon="close-circle-outline" testID={`${testID}-status`} />
          ) : null}
          {order.status === 'refunded' || order.status === 'partially_refunded' ? (
            <Chip
              label={order.refunded_cents > 0 ? `${orderStatusLabel(order.status)} · ${formatPeso(order.refunded_cents)}` : orderStatusLabel(order.status)}
              variant="processing"
              icon="return-down-back-outline"
              testID={`${testID}-status`}
            />
          ) : null}
          {/* Senior Citizen / PWD Discount (a local order stored before it has no flag). */}
          {order.has_sc_pwd ? <Chip label="SC/PWD" icon="id-card-outline" testID={`${testID}-sc-pwd`} /> : null}
          {order.customer ? <Chip label={order.customer.full_name} icon="person-outline" testID={`${testID}-customer`} /> : null}
          <Chip label={items} icon="bag-handle-outline" />
          {order.payment_methods.map((method) => (
            <Chip key={method} label={paymentMethodLabel(method)} variant="primary" testID={`${testID}-${method}`} />
          ))}
        </View>
      </Pressable>
    </Card>
  );
}

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
  queue: {
    minWidth: spacing.giant,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  queueText: {
    ...typography.heading,
    color: colors.accentDeep,
  },
  titles: {
    flex: 1,
    gap: spacing.xxs,
  },
  invoice: {
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
