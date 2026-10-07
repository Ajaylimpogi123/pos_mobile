import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AmountRow } from '@/components/shared/AmountRow';
import { DetailRow } from '@/components/shared/InfoCard';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { colors, iconSizes, layout, sizes, spacing, typography } from '@/constants/theme';
import { refundRoute } from '@/constants/routes';
import type { VoidOrderState } from '@/hooks/orders/useVoidOrder';
import { paymentMethodLabel } from '@/sale/payments';
import type { ReversalGate } from '@/sale/reversals';
import type { PrintableOrder, Refund } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatPeso } from '@/utils/money';

function useWhen() {
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  return (iso: string) => formatBranchDateTime(iso, timeZone) ?? iso;
}

/** A voided sale: who voided it and when, the reason, and the approver (Voids & Refunds, Phase 7). */
export function OrderVoidCard({ order }: { order: PrintableOrder }) {
  const when = useWhen();
  if (order.status !== 'voided') return null;
  return (
    <Card style={styles.card} testID="order-void">
      <View style={styles.header}>
        <Icon name="close-circle-outline" size={iconSizes.md} color={colors.dangerText} />
        <Text style={styles.title} accessibilityRole="header">
          Voided
        </Text>
      </View>
      <View style={styles.details}>
        <DetailRow
          label="Voided"
          value={[order.voided_at ? when(order.voided_at) : null, order.voided_by?.name ?? null].filter(Boolean).join(' · ')}
          testID="order-void-by"
        />
        {order.void_authorized_by ? (
          <DetailRow label="Approved by" value={order.void_authorized_by.name} testID="order-void-approver" />
        ) : null}
        {order.void_reason ? <DetailRow label="Reason" value={order.void_reason} testID="order-void-reason" /> : null}
      </View>
    </Card>
  );
}

function RefundBlock({ refund, index, first }: { refund: Refund; index: number; first: boolean }) {
  const when = useWhen();
  const testID = `order-refund-${index}`;
  return (
    <View style={[styles.refund, !first && styles.divider]} testID={testID}>
      <AmountRow
        label={when(refund.refunded_at)}
        detail={`${refund.refunded_by.name}${refund.authorized_by ? ` · approved by ${refund.authorized_by.name}` : ''}`}
        cents={refund.amount_cents}
        variant="strong"
        testID={`${testID}-amount`}
      />
      {refund.items.map((item) => (
        <Text key={item.order_item_id} style={styles.meta}>
          {item.qty} × {item.product_name} · {formatPeso(item.amount_cents)}
        </Text>
      ))}
      <Text style={styles.meta} testID={`${testID}-methods`}>
        {refund.payments
          .map((payment) => `${paymentMethodLabel(payment.method)} ${formatPeso(payment.amount_cents)}${payment.reference_no ? ` (Ref ${payment.reference_no})` : ''}`)
          .join(' · ')}
      </Text>
      <Text style={styles.meta} testID={`${testID}-reason`}>
        Reason: {refund.reason}
      </Text>
    </View>
  );
}

/** Each refund of the sale, oldest first: when, who, the approver, the lines, the amount and the methods. */
export function OrderRefundsCard({ order }: { order: PrintableOrder }) {
  const refunds = order.refunds ?? [];
  if (refunds.length === 0) return null;
  return (
    <Card style={styles.card} testID="order-refunds">
      <View style={styles.header}>
        <Icon name="return-down-back-outline" size={iconSizes.md} color={colors.warningText} />
        <Text style={styles.title} accessibilityRole="header">
          Refunds
        </Text>
      </View>
      {refunds.map((refund, index) => (
        <RefundBlock key={refund.ulid} refund={refund} index={index} first={index === 0} />
      ))}
      <AmountRow label="Refunded in all" cents={order.refunded_cents} variant="total" testID="order-refunded-total" />
    </Card>
  );
}

/** Refund and Void sale side by side (Void in the outlined danger style), or why they can't run (offline, unsynced, no shift). Nothing when neither applies. */
export function OrderReversalActions({ order, gate, voiding }: { order: PrintableOrder; gate: ReversalGate; voiding: VoidOrderState }) {
  if (!gate.notice && !gate.void && !gate.refund) return null;
  const messages = [...new Set([gate.void?.message, gate.refund?.message].filter((text): text is string => Boolean(text)))];
  return (
    <Card style={styles.card} testID="order-reversals">
      {gate.notice ? <Banner variant="info" message={gate.notice} testID="order-reversal-notice" /> : null}
      {gate.void || gate.refund ? (
        <View style={styles.actions}>
          {gate.refund ? (
            <Button
              title="Refund"
              leftIcon="return-down-back-outline"
              variant="secondary"
              onPress={() => router.push(refundRoute(order.ulid))}
              disabled={!gate.refund.enabled}
              style={styles.action}
              testID="order-refund-action"
            />
          ) : null}
          {gate.void ? (
            <Button
              title="Void sale"
              leftIcon="close-circle-outline"
              variant="danger"
              onPress={voiding.request}
              disabled={!gate.void.enabled}
              style={styles.action}
              testID="order-void-action"
            />
          ) : null}
        </View>
      ) : null}
      {messages.map((message) => (
        <Text key={message} style={styles.meta} testID="order-reversal-message">
          {message}
        </Text>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    flex: 1,
  },
  details: {
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm + spacing.xxs,
  },
  action: {
    flexGrow: 1,
    flexBasis: layout.reportNumberColumnWidth + spacing.giant,
  },
  refund: {
    gap: spacing.xxs,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
