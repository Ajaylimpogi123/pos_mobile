import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OrderReviewCard, OrderReviewDialog } from '@/components/orders/OrderReviewCard';
import { ReprintDialog } from '@/components/orders/ReprintDialog';
import { ReprintStatusCard } from '@/components/orders/ReprintStatusCard';
import { OrderRefundsCard, OrderReversalActions, OrderVoidCard } from '@/components/orders/ReversalCards';
import { ScPwdCard } from '@/components/orders/ScPwdCard';
import { ScPwdAmountRows } from '@/components/sell/ScPwdAmountRows';
import { VoidDialog } from '@/components/orders/VoidDialog';
import { AmountRow } from '@/components/shared/AmountRow';
import { DetailRow } from '@/components/shared/InfoCard';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { TopBar } from '@/components/ui/TopBar';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { showVatBreakdown } from '@/constants/features';
import { ROUTES } from '@/constants/routes';
import { colors, layout, numeric, radius, sizes, spacing, typography } from '@/constants/theme';
import type { LocalOrderBadge } from '@/hooks/orders/useLocalOrders';
import { useOrderReview } from '@/hooks/orders/useOrderReview';
import { useReprint } from '@/hooks/orders/useReprint';
import { useReversalGate } from '@/hooks/orders/useReversalGate';
import { useVoidOrder } from '@/hooks/orders/useVoidOrder';
import { useResponsive } from '@/hooks/useResponsive';
import { describeDiscount } from '@/sale/discountRules';
import { orderNumberLabel, ticketNumberLabel } from '@/sale/localOrder';
import { paymentMethodLabel } from '@/sale/payments';
import { VAT_RATE_BPS } from '@/sale/pricing';
import { orderStatusLabel } from '@/sale/reversals';
import type { OrderItem, OrderPayment, OrderStatus, PrintableOrder } from '@/services/types';
import { formatBusinessDate, formatClockTime, formatShortDate } from '@/utils/dates';
import { formatPeso } from '@/utils/money';
import { formatPercentBps } from '@/utils/numbers';
import { goBackOr } from '@/utils/navigation';

type OrderDetailScreenProps = {
  /** The server's `Order`, or the local order of a sale saved on this tablet. */
  order: PrintableOrder;
  /** Offline Sales: a local sale that hasn't synced (read from the local JSON). */
  local?: { badge: LocalOrderBadge; lastError: string | null } | null;
};

const LOCAL_BADGES: Record<LocalOrderBadge, { label: string; variant: 'pending' | 'cancelled'; icon: 'cloud-upload-outline' | 'alert-circle-outline' }> = {
  pending: { label: 'Not synced yet', variant: 'pending', icon: 'cloud-upload-outline' },
  needs_attention: { label: 'Needs attention', variant: 'cancelled', icon: 'alert-circle-outline' },
};

/** Offline Sales: what a local sale's detail says about its sync. */
export const LOCAL_PENDING_MESSAGE = 'Saved on this tablet while offline. It syncs by itself; the invoice number comes then.';

/** Voids & Refunds (Phase 7): each status's chip. */
const STATUS_LOOKS: Record<OrderStatus, { variant: 'completed' | 'cancelled' | 'pending'; icon: 'checkmark-circle-outline' | 'close-circle-outline' | 'return-down-back-outline' }> = {
  completed: { variant: 'completed', icon: 'checkmark-circle-outline' },
  voided: { variant: 'cancelled', icon: 'close-circle-outline' },
  refunded: { variant: 'pending', icon: 'return-down-back-outline' },
  partially_refunded: { variant: 'pending', icon: 'return-down-back-outline' },
};

function ItemRow({ item, first }: { item: OrderItem; first: boolean }) {
  const testID = `order-item-${item.id}`;
  return (
    <View style={[styles.item, !first && styles.divider]} testID={testID}>
      <View style={styles.itemTop}>
        <Text style={styles.itemQty} numberOfLines={1}>{`${item.qty} × `}</Text>
        <Text style={styles.itemName} numberOfLines={2}>
          {item.product_name}
        </Text>
        <Text style={styles.itemTotal} numberOfLines={1} testID={`${testID}-total`}>
          {formatPeso(item.line_total_cents)}
        </Text>
      </View>
      <View style={styles.itemBody}>
      <Text style={styles.itemMeta}>
        {formatPeso(item.unit_price_cents)} each · {item.category_name}
        {item.sku ? ` · ${item.sku}` : ''}
        {item.is_vatable || !showVatBreakdown() ? '' : ' · VAT-exempt'}
      </Text>
      {item.sc_pwd ? <Chip label="SC/PWD" variant="info" icon="id-card-outline" testID={`${testID}-sc-pwd`} /> : null}
      {item.discount && item.line_discount_cents > 0 ? (
        <Text style={styles.itemMeta} testID={`${testID}-discount`}>
          {describeDiscount(item.discount)} · −{formatPeso(item.line_discount_cents)}
        </Text>
      ) : null}
      {item.order_discount_share_cents > 0 ? (
        <Text style={styles.itemMeta}>Share of order discount · −{formatPeso(item.order_discount_share_cents)}</Text>
      ) : null}
      {item.notes ? <Text style={styles.itemMeta}>“{item.notes}”</Text> : null}
      {item.refunded_qty > 0 ? (
        <Text style={styles.refunded} testID={`${testID}-refunded`}>
          Refunded {item.refunded_qty} of {item.qty} · −{formatPeso(item.refunded_cents)}
        </Text>
      ) : null}
      </View>
    </View>
  );
}

function PaymentRow({ payment, index }: { payment: OrderPayment; index: number }) {
  const testID = `order-payment-${index}`;
  let detail: string | undefined;
  if (payment.method === 'gcash') detail = payment.reference_no ? `Ref ${payment.reference_no}` : undefined;
  else if (payment.tendered_cents !== null) {
    detail = `Tendered ${formatPeso(payment.tendered_cents)} · change ${formatPeso(payment.change_cents)}`;
  }
  return <AmountRow label={paymentMethodLabel(payment.method)} detail={detail} cents={payment.amount_cents} testID={testID} />;
}

/**
 * An order as a receipt (docs/api-contract.md → Shared object `Order`): the
 * queue and invoice numbers, when and by whom, the lines with their
 * discounts, the totals, the VAT breakdown (and the lines' "VAT-exempt" tag;
 * both only while `SHOW_VAT_BREAKDOWN` is on, see `constants/features.ts`),
 * the payments, tendered and change. Tablet landscape shows the lines beside the totals; elsewhere one
 * centred column. Everything comes from the server; nothing is recomputed.
 *
 * Printing (Phase 4): **Reprint** → Receipt or Kitchen tickets (all stations),
 * marked `*** REPRINT ***`, with each job's progress under the totals.
 *
 * Offline Sales (Phase 5): a sale saved on this tablet shows its `order_no`,
 * the kitchen's number (`T01-5`) and its sync state (with the server's
 * message when it needs attention), and reprints from the local JSON. A
 * flagged offline sale shows its review reasons and, with `order.review`,
 * **Mark reviewed**.
 *
 * Senior Citizen / PWD Discount: the SC/PWD block (mode, persons with their
 * IDs, the amounts), its rows in the totals, and an `SC/PWD` chip on its lines.
 *
 * Voids & Refunds (Phase 7): the status chip (Voided, Refunded, Partly
 * refunded), **Void sale** and **Refund** with their gating (`useReversalGate`),
 * the void block, each refund, the per-line refunded quantity, and Reprint →
 * Void slip / Refund slip.
 */
export function OrderDetailScreen({ order, local = null }: OrderDetailScreenProps) {
  const { isTwoPane, screenPaddingX, screenPaddingY, gutter } = useResponsive();
  const reprint = useReprint(order);
  const review = useOrderReview(order);
  const voiding = useVoidOrder(order);
  const gate = useReversalGate(order, local !== null);
  const statusLook = STATUS_LOOKS[order.status] ?? STATUS_LOOKS.completed;
  const number = ticketNumberLabel(order);
  const title = orderNumberLabel(order);
  const localBadge = local ? LOCAL_BADGES[local.badge] : null;
  const time = formatClockTime(order.placed_at);
  const placed = Number.isNaN(Date.parse(order.placed_at))
    ? order.placed_at
    : `${formatShortDate(new Date(order.placed_at))}${time ? `, ${time}` : ''}`;

  return (
    <Screen edges={[]} testID="order-detail-screen">
      <TopBar
        title={title}
        left={
          <IconButton
            icon="arrow-back"
            variant="bar"
            accessibilityLabel="Back"
            onPress={() => goBackOr(ROUTES.orders)}
            testID="order-back"
          />
        }
        right={
          <IconButton
            icon="print-outline"
            variant="accent"
            accessibilityLabel="Reprint"
            onPress={reprint.request}
            testID="order-reprint-icon"
          />
        }
        testID="order-header"
      >
        {order.table_no ? (
          <Chip label={`Table ${order.table_no}`} variant="primary" icon="restaurant-outline" testID="order-table" />
        ) : null}
      </TopBar>
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }} testID="order-scroll">
          <View
            style={[
              styles.inner,
              { gap: gutter, maxWidth: isTwoPane ? layout.formWideMaxWidth : layout.receiptMaxWidth },
              isTwoPane ? styles.row : styles.column,
            ]}
          >
            <Card style={[styles.card, isTwoPane ? styles.mainPane : styles.full]} testID="order-receipt">
              <View style={styles.head}>
                <View style={styles.queue} accessible accessibilityLabel={`Queue number ${number}`}>
                  <Text style={styles.queueLabel}>Queue</Text>
                  <Text style={styles.queueValue} testID="order-queue">
                    {number}
                  </Text>
                </View>
                <View style={styles.headText}>
                  <Text style={styles.invoice} numberOfLines={1} testID="order-invoice">
                    {title}
                  </Text>
                  {order.invoice_no !== null && order.order_no ? (
                    <Text style={styles.meta} testID="order-order-no">
                      Offline sale {order.order_no}
                    </Text>
                  ) : null}
                  <Text style={styles.meta}>{placed}</Text>
                  <Text style={styles.meta}>Business day {formatBusinessDate(order.business_date)}</Text>
                </View>
                {localBadge ? (
                  <Chip label={localBadge.label} variant={localBadge.variant} icon={localBadge.icon} testID="order-local-status" />
                ) : (
                  <Chip
                    label={orderStatusLabel(order.status)}
                    variant={statusLook.variant}
                    icon={statusLook.icon}
                    testID="order-status"
                  />
                )}
              </View>

              {local ? (
                <Banner
                  variant={local.badge === 'needs_attention' ? 'error' : 'info'}
                  message={local.badge === 'needs_attention' && local.lastError ? local.lastError : LOCAL_PENDING_MESSAGE}
                  testID="order-local-message"
                />
              ) : null}

              <View style={styles.details} testID="order-people">
                <DetailRow label="Cashier" value={order.cashier.name} testID="order-cashier" />
                {order.authorized_by ? (
                  <DetailRow label="Discount approved by" value={order.authorized_by.name} testID="order-approver" />
                ) : null}
                <DetailRow label="Customer" value={order.customer?.full_name ?? 'Walk-in'} testID="order-customer" />
              </View>

              <View>
                {order.items.map((item, index) => (
                  <ItemRow key={item.id} item={item} first={index === 0} />
                ))}
              </View>
              {order.notes ? <Text style={styles.meta}>Note: {order.notes}</Text> : null}
            </Card>

            <View style={[isTwoPane ? styles.asidePane : styles.full, { gap: gutter }]}>
              <Card style={styles.card} testID="order-totals">
                <View style={styles.rows}>
                  <AmountRow label="Subtotal" cents={order.subtotal_cents} testID="order-subtotal" />
                  {order.line_discounts_cents > 0 ? (
                    <AmountRow label="Line discounts" cents={order.line_discounts_cents} deduction testID="order-line-discounts" />
                  ) : null}
                  {order.order_discount ? (
                    <AmountRow
                      label="Order discount"
                      detail={describeDiscount(order.order_discount)}
                      cents={order.order_discount.amount_cents}
                      deduction
                      testID="order-order-discount"
                    />
                  ) : null}
                  {order.sc_pwd ? (
                    <ScPwdAmountRows
                      vatExempt={order.sc_pwd.vat_exempt}
                      reliefCents={order.sc_pwd.vat_relief_cents}
                      discountCents={order.sc_pwd.discount_cents}
                      testIDPrefix="order"
                    />
                  ) : null}
                  <AmountRow label="Total" cents={order.total_cents} variant="total" testID="order-total" />
                </View>

                {showVatBreakdown() ? (
                  <View style={[styles.rows, styles.section]}>
                    <AmountRow label="VATable sales" cents={order.vatable_sales_cents} variant="muted" testID="order-vatable" />
                    <AmountRow
                      label={`VAT (${formatPercentBps(VAT_RATE_BPS, 0)})`}
                      cents={order.vat_amount_cents}
                      variant="muted"
                      testID="order-vat"
                    />
                    <AmountRow label="VAT-exempt sales" cents={order.vat_exempt_sales_cents} variant="muted" testID="order-vat-exempt" />
                  </View>
                ) : null}

                <View style={[styles.rows, styles.section]} testID="order-payments">
                  <Text style={styles.sectionTitle}>Payments</Text>
                  {order.payments.map((payment, index) => (
                    <PaymentRow key={`${payment.method}-${index}`} payment={payment} index={index} />
                  ))}
                  <AmountRow label="Tendered" cents={order.tendered_cents} variant="strong" testID="order-tendered" />
                  <AmountRow label="Change" cents={order.change_cents} variant="strong" testID="order-change" />
                </View>

                {order.has_total_mismatch ? (
                  <Banner
                    variant="info"
                    message="The device's total differed from the server's by ₱0.01 (rounding). The server's total was charged."
                    testID="order-mismatch"
                  />
                ) : null}
                <Button
                  title="Reprint"
                  leftIcon="print-outline"
                  variant="secondary"
                  onPress={reprint.request}
                  testID="order-reprint"
                />
              </Card>
              {order.sc_pwd ? <ScPwdCard scPwd={order.sc_pwd} /> : null}
              <OrderReversalActions order={order} gate={gate} voiding={voiding} />
              <OrderVoidCard order={order} />
              <OrderRefundsCard order={order} />
              <OrderReviewCard order={order} review={review} />
              <ReprintStatusCard reprint={reprint} />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
      <ReprintDialog reprint={reprint} />
      <OrderReviewDialog review={review} />
      <VoidDialog order={order} voiding={voiding} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  inner: {
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    flexDirection: 'column',
  },
  mainPane: {
    flex: layout.mainPaneFlex,
  },
  asidePane: {
    flex: layout.asidePaneFlex,
  },
  full: {
    width: '100%',
  },
  card: {
    gap: spacing.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  queue: {
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  queueLabel: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  queueValue: {
    ...typography.title,
    color: colors.accentDeep,
  },
  headText: {
    flex: 1,
    minWidth: layout.sectionTitleMinWidth,
    gap: spacing.xxs,
  },
  invoice: {
    ...typography.heading,
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  /** The people block: a soft rounded panel (Sage "Orders" detail). */
  details: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  item: {
    gap: spacing.xxs,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  /** "2 ×": a fixed muted column, so names line up. */
  itemQty: {
    ...typography.controlStrong,
    ...numeric,
    color: colors.textSecondary,
    minWidth: spacing.xxxl + spacing.xs,
  },
  itemName: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  itemBody: {
    gap: spacing.xxs,
    paddingLeft: spacing.xxxl + spacing.xs + spacing.md,
  },
  itemTotal: {
    ...typography.control,
    ...numeric,
    color: colors.text,
  },
  itemMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  refunded: {
    ...typography.captionStrong,
    color: colors.warningText,
  },
  rows: {
    gap: spacing.sm,
  },
  section: {
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.text,
  },
});
