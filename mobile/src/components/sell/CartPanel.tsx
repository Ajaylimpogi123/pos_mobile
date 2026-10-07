import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CartLineRow } from '@/components/sell/CartLineRow';
import { ScPwdAmountRows } from '@/components/sell/ScPwdAmountRows';
import { AmountRow } from '@/components/shared/AmountRow';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { showVatBreakdown } from '@/constants/features';
import {
  colors,
  hitTarget,
  iconSizes,
  layout,
  opacity,
  pressedScale,
  radius,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';
import type { CartView } from '@/hooks/sell/useCart';
import type { CartEditors } from '@/hooks/sell/useCartEditors';
import { useStockWarnings } from '@/hooks/sell/useStockWarnings';
import { useCanReachServer } from '@/hooks/useIsOnline';
import { useResponsive } from '@/hooks/useResponsive';
import { describeDiscount } from '@/sale/discountRules';
import { OFFLINE_APPROVAL_MESSAGE } from '@/sale/offlineSale';
import { VAT_RATE_BPS } from '@/sale/pricing';
import { describeScPwd } from '@/sale/scPwd';
import { useCartStore } from '@/stores/cart';
import { formatPeso } from '@/utils/money';
import { formatPercentBps } from '@/utils/numbers';

type CartPanelProps = {
  /** `side`: the permanent panel beside the menu (tablet landscape). `sheet`: inside the cart sheet. */
  variant: 'side' | 'sheet';
  cart: CartView;
  editors: CartEditors;
};

export const AWAITING_CART_MESSAGE =
  "We couldn't confirm the last sale attempt. Retry it from checkout before changing the cart.";

function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/**
 * The current order (POS board → right panel):
 * - header: "Current order", the item count and table, a clear button, and
 *   the customer row (dashed; opens the customer search);
 * - the table number (Core Sale revision 2), then the lines (thumbnail, name,
 *   each price, the bordered stepper, the line total; a tap opens the editor);
 * - the action row: Discount (the order discount; not with SC/PWD) and
 *   SC / PWD (opens its sheet), with what is set under it;
 * - the summary (subtotal, discounts, the SC/PWD rows, and "VAT included"
 *   only while `SHOW_VAT_BREAKDOWN` is on, see `constants/features.ts`) with
 *   the large tabular total, and the 60 dp **Charge ₱…** button.
 * The header and lines scroll; the summary and Charge stay pinned at the
 * bottom (on short heights only Charge stays pinned). The same component is
 * the side panel on tablet landscape (full height, its own safe-area edges)
 * and the content of the cart sheet elsewhere.
 */
export function CartPanel({ variant, cart, editors }: CartPanelProps) {
  const { isCompactHeight } = useResponsive();
  const { pricing } = cart;
  const locked = cart.awaitingConfirmation;
  const setQty = useCartStore((state) => state.setQty);
  const removeLine = useCartStore((state) => state.removeLine);
  const setTableNo = useCartStore((state) => state.setTableNo);
  const side = variant === 'side';
  const online = useCanReachServer();
  const stockWarnings = useStockWarnings(cart.lines);
  const table = cart.tableNo.trim();
  const charge = formatPeso(pricing.total_cents);

  const totals = (
    <View style={styles.totals} testID="cart-totals">
      <AmountRow label="Subtotal" cents={pricing.subtotal_cents} variant="summary" testID="cart-subtotal" />
      {pricing.regular_discount_cents > 0 ? (
        <AmountRow label="Discounts" cents={pricing.regular_discount_cents} deduction variant="summary" testID="cart-discounts" />
      ) : null}
      {cart.scPwd ? (
        <ScPwdAmountRows
          vatExempt={cart.scPwd.vat_exempt}
          reliefCents={pricing.sc_pwd_vat_relief_cents}
          discountCents={pricing.sc_pwd_discount_cents}
          testIDPrefix="cart"
          variant="summary"
        />
      ) : null}
      {showVatBreakdown() ? (
        <AmountRow
          label={`VAT (${formatPercentBps(VAT_RATE_BPS, 0)}, included)`}
          cents={pricing.vat_amount_cents}
          variant="summary"
          testID="cart-vat"
        />
      ) : null}
      <View style={styles.totalDivider} />
      <AmountRow label="Total" cents={pricing.total_cents} variant="total" testID="cart-total" />
    </View>
  );

  const approvalHint = cart.needsApproval ? (
    <View style={styles.hint} testID="cart-approval-hint">
      <Icon name="shield-checkmark-outline" size={iconSizes.sm} color={colors.infoText} />
      <Text style={styles.hintText}>
        {online ? 'A manager must approve this discount at checkout.' : OFFLINE_APPROVAL_MESSAGE}
      </Text>
    </View>
  ) : null;

  return (
    <SafeAreaView
      edges={side ? ['top', 'right', 'bottom'] : []}
      style={[styles.panel, side ? styles.side : styles.sheet]}
      testID={`cart-panel-${variant}`}
    >
      <View style={[styles.header, side ? styles.headerSide : styles.headerSheet]}>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text style={styles.title} accessibilityRole="header">
              Current order
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              <Text testID="cart-count">{itemsLabel(cart.itemCount)}</Text>
              {table !== '' && !cart.tableError ? ` · Table ${table}` : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear cart"
            accessibilityState={{ disabled: cart.isEmpty }}
            disabled={cart.isEmpty}
            onPress={editors.requestClear}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.square, pressed && styles.squarePressed, cart.isEmpty && styles.disabled]}
            testID="cart-clear"
          >
            <Icon name="trash-outline" size={iconSizes.md} color={colors.textSecondary} />
          </Pressable>
          {side ? null : (
            <IconButton icon="close" variant="ghost" accessibilityLabel="Close cart" onPress={editors.closeSheet} testID="cart-close" />
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cart.customer ? `Customer: ${cart.customer.full_name}` : 'Add a customer'}
          accessibilityHint="Opens the customer search"
          accessibilityState={{ disabled: locked }}
          disabled={locked}
          onPress={editors.openCustomerPicker}
          style={({ pressed }) => [
            styles.customer,
            cart.customer ? styles.customerSet : styles.customerEmpty,
            pressed && styles.customerPressed,
            locked && styles.disabled,
          ]}
          testID="cart-customer"
        >
          <Icon name="person-outline" size={iconSizes.md} color={cart.customer ? colors.primaryDark : colors.textResting} />
          <Text style={cart.customer ? styles.customerName : styles.customerPlaceholder} numberOfLines={1}>
            {cart.customer ? cart.customer.full_name : 'Walk-in customer'}
          </Text>
          <Text style={styles.customerAction}>{cart.customer ? 'Change' : 'Add'}</Text>
        </Pressable>
        {cart.customerError ? (
          <Text style={styles.error} testID="cart-customer-error">
            {cart.customerError}
          </Text>
        ) : null}
      </View>

      <ScrollView
        style={side ? styles.scrollSide : styles.scrollSheet}
        contentContainerStyle={[styles.scrollContent, side ? styles.padSide : styles.padSheet]}
        keyboardShouldPersistTaps="handled"
        testID="cart-scroll"
      >
        {locked ? <Banner variant="warning" message={AWAITING_CART_MESSAGE} testID="cart-awaiting" /> : null}
        {cart.cartError ? <Banner message={cart.cartError} testID="cart-error" /> : null}

        <Input
          label="Table (optional)"
          value={cart.tableNo}
          onChangeText={setTableNo}
          error={cart.tableError}
          placeholder="e.g. 12"
          leftIcon="restaurant-outline"
          autoCorrect={false}
          returnKeyType="done"
          editable={!locked}
          testID="cart-table"
        />

        {cart.isEmpty ? (
          <View style={styles.empty} testID="cart-empty">
            <View style={styles.emptyIcon}>
              <Icon name="cart-outline" size={iconSizes.lg} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptyText}>Tap items on the menu to add them.</Text>
          </View>
        ) : (
          <View>
            {cart.lines.map((line, index) => (
              <CartLineRow
                key={line.key}
                line={line}
                priced={pricing.lines[index]}
                index={index}
                scPwd={cart.itemsMode && line.scPwd}
                error={cart.lineErrors[line.key]}
                warning={stockWarnings[line.key]}
                locked={locked}
                onEdit={editors.editLine}
                onQtyChange={setQty}
                onRemove={removeLine}
              />
            ))}
          </View>
        )}

        {cart.isEmpty ? null : (
          <View style={styles.actions}>
            <Button
              title="Discount"
              leftIcon="pricetags-outline"
              variant={cart.orderDiscount ? 'tonal' : 'secondary'}
              onPress={editors.editOrderDiscount}
              // No double discount: an order with SC/PWD takes no order discount.
              disabled={locked || cart.scPwd !== null}
              accessibilityLabel={cart.scPwd ? 'Order discount: not with SC/PWD' : undefined}
              style={styles.action}
              testID="cart-order-discount-edit"
            />
            <Button
              title="SC / PWD"
              leftIcon="id-card-outline"
              variant={cart.scPwd ? 'tonal' : 'secondary'}
              onPress={editors.scPwd.open}
              disabled={locked}
              accessibilityLabel={cart.scPwd ? 'Edit SC/PWD' : 'Add SC/PWD'}
              style={styles.action}
              testID="cart-sc-pwd-edit"
            />
          </View>
        )}
        {cart.orderDiscount ? (
          <Text style={styles.applied} testID="cart-order-discount">
            {describeDiscount(cart.orderDiscount)} · −{formatPeso(pricing.order_discount_cents)}
          </Text>
        ) : null}
        {cart.scPwd && !cart.isEmpty ? (
          <Text style={styles.appliedMuted} testID="cart-order-discount-locked">
            Order discount: not with SC/PWD
          </Text>
        ) : null}
        {cart.orderDiscountError ? (
          <Text style={styles.error} testID="cart-order-discount-error">
            {cart.orderDiscountError}
          </Text>
        ) : null}
        {cart.scPwd && !cart.isEmpty ? (
          <Text style={styles.applied} testID="cart-sc-pwd">
            {describeScPwd(cart.scPwd)}
            {cart.scPwd.vat_exempt ? ' · VAT exempt' : ''}
          </Text>
        ) : null}
        {cart.scPwdError ? (
          <Text style={styles.error} testID="cart-sc-pwd-error">
            {cart.scPwdError}
          </Text>
        ) : null}

        {isCompactHeight ? totals : null}
        {isCompactHeight ? approvalHint : null}
      </ScrollView>

      <View style={[styles.footer, side ? styles.padSide : styles.padSheet]}>
        {isCompactHeight ? null : totals}
        {isCompactHeight ? null : approvalHint}
        <Button
          title={locked ? 'Retry at checkout' : `Charge ${charge}`}
          leftIcon={locked ? 'refresh' : undefined}
          rightIcon={locked ? undefined : 'arrow-forward'}
          size="xl"
          onPress={editors.checkout}
          disabled={cart.isEmpty || (!locked && cart.hasProblems)}
          accessibilityLabel={locked ? 'Retry the sale at checkout' : `Charge ${charge}`}
          testID="cart-checkout"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
  },
  side: {
    width: layout.cartPanelWidth,
    borderLeftWidth: sizes.borderWidth,
    borderLeftColor: colors.border,
  },
  sheet: {
    flexShrink: 1,
  },
  header: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.border,
  },
  headerSide: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  headerSheet: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  titleText: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.brandName,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  square: {
    width: hitTarget.min,
    height: hitTarget.min,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squarePressed: {
    backgroundColor: colors.surfaceMuted,
    transform: [{ scale: pressedScale }],
  },
  disabled: {
    opacity: opacity.disabled,
  },
  customer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xxs,
    minHeight: hitTarget.primary,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    paddingHorizontal: spacing.md,
  },
  customerEmpty: {
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  customerSet: {
    borderColor: colors.primarySoft,
    backgroundColor: colors.primarySoft,
  },
  customerPressed: {
    backgroundColor: colors.surfaceMuted,
    transform: [{ scale: pressedScale }],
  },
  customerName: {
    ...typography.controlStrong,
    color: colors.primaryDark,
    flex: 1,
  },
  customerPlaceholder: {
    ...typography.control,
    color: colors.textResting,
    flex: 1,
  },
  customerAction: {
    ...typography.control,
    color: colors.primary,
  },
  scrollSide: {
    flex: 1,
  },
  scrollSheet: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  padSide: {
    paddingHorizontal: spacing.xl,
  },
  padSheet: {
    paddingHorizontal: spacing.lg,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxl,
  },
  emptyIcon: {
    width: sizes.badge.lg,
    height: sizes.badge.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    ...typography.section,
    color: colors.text,
  },
  emptyText: {
    ...typography.bodySm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  action: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  applied: {
    ...typography.label,
    color: colors.primaryDark,
  },
  appliedMuted: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  footer: {
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  totals: {
    gap: spacing.sm,
  },
  totalDivider: {
    height: sizes.borderWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.infoSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  hintText: {
    ...typography.caption,
    color: colors.infoText,
    flex: 1,
  },
});
