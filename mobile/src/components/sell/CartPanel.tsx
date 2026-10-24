import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CartLineRow } from '@/components/sell/CartLineRow';
import { ScPwdAmountRows } from '@/components/sell/ScPwdAmountRows';
import { AmountRow } from '@/components/shared/AmountRow';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { showVatBreakdown } from '@pos/core/features';
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
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useResponsive } from '@/hooks/useResponsive';
import { describeDiscount } from '@pos/core/sale/discountRules';
import { OFFLINE_APPROVAL_MESSAGE } from '@/sale/offlineSale';
import { VAT_RATE_BPS } from '@pos/core/sale/pricing';
import { describeScPwd } from '@pos/core/sale/scPwd';
import { useCartStoreApi } from '@/stores/cart';
import { formatPeso } from '@pos/core/money';
import { formatPercentBps } from '@pos/core/numbers';

type CartPanelProps = {
  /**
   * `side`: the fixed 360 dp column beside the menu (tablet landscape).
   * `below`: under the menu, always visible (tablet portrait); the pinned
   * bottom bar carries **Checkout**, so the card has none.
   * `sheet`: inside the cart sheet (phones).
   */
  variant: 'side' | 'below' | 'sheet';
  cart: CartView;
  editors: CartEditors;
};

export const AWAITING_CART_MESSAGE =
  "We couldn't confirm the last sale attempt. Retry it from checkout before changing the cart.";

export function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/** The label of the Checkout pill (here, in the bottom bar and on the tab bill). */
export function checkoutLabel(totalCents: number): string {
  return `Checkout (${formatPeso(totalCents)})`;
}

/**
 * The Current Order card (MASTER §3, sell.md), top to bottom:
 * - "Current Order" (20 / 700) with an "n items" badge, and Clear;
 * - **Table** and **Customer** outline buttons (Table opens a small dialog with
 *   the table-number field; Customer opens the customer search);
 * - the line boxes, newest first (a tap on the menu highlights its line);
 * - the `subtle` summary box: Subtotal, the red **Discount** row with its
 *   **SC/PWD** and **Amount** buttons (the discount sheet and the order
 *   discount; not both), the deductions, and the bordered green **Total**;
 * - the 52 dp **Checkout (₱total)** pill (not in `below`: the bottom bar has it).
 * The header and lines scroll; the summary and Checkout stay pinned at the
 * bottom (on short heights, and in `below`, the summary scrolls with the lines).
 */
export function CartPanel({ variant, cart, editors }: CartPanelProps) {
  const { isCompactHeight } = useResponsive();
  const reduceMotion = useReducedMotion();
  const { pricing } = cart;
  const locked = cart.awaitingConfirmation;
  const useCartStore = useCartStoreApi();
  const setQty = useCartStore((state) => state.setQty);
  const removeLine = useCartStore((state) => state.removeLine);
  const setTableNo = useCartStore((state) => state.setTableNo);
  const side = variant === 'side';
  const below = variant === 'below';
  const online = useCanReachServer();
  const stockWarnings = useStockWarnings(cart.lines);
  const table = cart.tableNo.trim();
  const [tableOpen, setTableOpen] = useState(false);
  const summaryScrolls = isCompactHeight || below;
  const padStyle = side ? styles.padSide : styles.padSheet;

  const summary = (
    <View style={styles.summary} testID="cart-totals">
      <AmountRow label="Subtotal" cents={pricing.subtotal_cents} variant="summary" testID="cart-subtotal" />
      {cart.isEmpty ? null : (
        <View style={styles.discountRow}>
          <Text style={styles.discountLabel}>Discount</Text>
          <View style={styles.discountActions}>
            <Button
              title="SC/PWD"
              leftIcon="id-card-outline"
              variant="secondary"
              onPress={editors.scPwd.open}
              disabled={locked}
              accessibilityLabel={cart.scPwd ? 'Edit SC/PWD' : 'Add SC/PWD'}
              style={styles.discountButton}
              testID="cart-sc-pwd-edit"
            />
            <Button
              title="Amount"
              leftIcon="pricetags-outline"
              variant="secondary"
              onPress={editors.editOrderDiscount}
              // No double discount: an order with SC/PWD takes no order discount.
              disabled={locked || cart.scPwd !== null}
              accessibilityLabel={cart.scPwd ? 'Order discount: not with SC/PWD' : 'Order discount'}
              style={styles.discountButton}
              testID="cart-order-discount-edit"
            />
          </View>
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
      <View style={styles.totalBox}>
        <AmountRow label="Total" cents={pricing.total_cents} variant="total" testID="cart-total" />
      </View>
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

  // Newest first (sell.md); each row keeps its cart index (pricing and test IDs follow the cart order).
  const rows = cart.lines
    .map((line, index) => ({ line, index }))
    .reverse()
    .map(({ line, index }) => (
      <CartLineRow
        key={line.key}
        line={line}
        priced={pricing.lines[index]}
        index={index}
        scPwd={cart.itemsMode && line.scPwd}
        error={cart.lineErrors[line.key]}
        warning={stockWarnings[line.key]}
        locked={locked}
        highlightToken={editors.highlight.productId === line.product.id ? editors.highlight.token : 0}
        onEdit={editors.editLine}
        onQtyChange={setQty}
        onRemove={removeLine}
      />
    ));

  let edges: ('top' | 'right' | 'bottom' | 'left')[] = [];
  if (side) edges = ['top', 'right', 'bottom'];
  else if (below) edges = ['left', 'right'];

  return (
    <SafeAreaView edges={edges} style={[styles.panel, styles[variant]]} testID={`cart-panel-${variant}`}>
      <View style={[styles.header, side ? styles.headerSide : styles.headerSheet]}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            Current Order
          </Text>
          <Chip label={itemsLabel(cart.itemCount)} testID="cart-count" />
          <View style={styles.titleSpacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear cart"
            accessibilityState={{ disabled: cart.isEmpty }}
            disabled={cart.isEmpty}
            onPress={editors.requestClear}
            hitSlop={(hitTarget.primary - hitTarget.min) / 2}
            style={({ pressed }) => [
              styles.square,
              pressed && styles.squarePressed,
              pressed && !reduceMotion && styles.squareScaled,
              cart.isEmpty && styles.disabled,
            ]}
            testID="cart-clear"
          >
            <Icon name="trash-outline" size={iconSizes.md} color={colors.textSecondary} />
          </Pressable>
          {variant === 'sheet' ? (
            <IconButton icon="close" variant="ghost" accessibilityLabel="Close cart" onPress={editors.closeSheet} testID="cart-close" />
          ) : null}
        </View>

        <View style={styles.buttons}>
          <Button
            title={table !== '' && !cart.tableError ? `Table ${table}` : 'Table'}
            leftIcon="restaurant-outline"
            variant="secondary"
            onPress={() => setTableOpen(true)}
            disabled={locked}
            accessibilityLabel={table !== '' ? `Table: ${table}. Change the table number` : 'Add a table number'}
            style={[styles.halfButton, cart.tableError ? styles.buttonError : null]}
            testID="cart-table-button"
          />
          <Button
            title={cart.customer ? cart.customer.full_name : 'Customer'}
            leftIcon="person-outline"
            variant="secondary"
            onPress={editors.openCustomerPicker}
            disabled={locked}
            accessibilityLabel={cart.customer ? `Customer: ${cart.customer.full_name}` : 'Add a customer'}
            accessibilityHint="Opens the customer search"
            style={styles.halfButton}
            testID="cart-customer"
          />
        </View>
        {cart.tableError && !tableOpen ? (
          <Text style={styles.error} testID="cart-table-error">
            {cart.tableError}
          </Text>
        ) : null}
        {cart.customerError ? (
          <Text style={styles.error} testID="cart-customer-error">
            {cart.customerError}
          </Text>
        ) : null}
      </View>

      <ScrollView
        style={variant === 'sheet' ? styles.scrollSheet : styles.scrollFill}
        contentContainerStyle={[styles.scrollContent, padStyle]}
        keyboardShouldPersistTaps="handled"
        testID="cart-scroll"
      >
        {locked ? <Banner variant="warning" message={AWAITING_CART_MESSAGE} testID="cart-awaiting" /> : null}
        {cart.cartError ? <Banner message={cart.cartError} testID="cart-error" /> : null}

        {cart.isEmpty ? (
          <View style={styles.empty} testID="cart-empty">
            <View style={styles.emptyIcon}>
              <Icon name="cart-outline" size={iconSizes.lg} color={colors.green} />
            </View>
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptyText}>Tap + Add on the menu to add items.</Text>
          </View>
        ) : (
          <View style={styles.lines}>{rows}</View>
        )}

        {summaryScrolls ? summary : null}
        {summaryScrolls ? approvalHint : null}
      </ScrollView>

      {below ? null : (
        <View style={[styles.footer, padStyle]}>
          {summaryScrolls ? null : summary}
          {summaryScrolls ? null : approvalHint}
          <Button
            title={locked ? 'Retry at checkout' : checkoutLabel(pricing.total_cents)}
            leftIcon={locked ? 'refresh' : undefined}
            size="xl"
            onPress={editors.checkout}
            disabled={cart.isEmpty || (!locked && cart.hasProblems)}
            accessibilityLabel={locked ? 'Retry the sale at checkout' : checkoutLabel(pricing.total_cents)}
            testID="cart-checkout"
          />
        </View>
      )}

      <DialogFrame visible={tableOpen} onRequestClose={() => setTableOpen(false)} testID="cart-table-dialog">
        <Text style={styles.dialogTitle} accessibilityRole="header">
          Table number
        </Text>
        <Input
          label="Table (optional)"
          value={cart.tableNo}
          onChangeText={setTableNo}
          error={cart.tableError}
          placeholder="e.g. 12"
          leftIcon="restaurant-outline"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => setTableOpen(false)}
          editable={!locked}
          testID="cart-table"
        />
        <Button title="Done" onPress={() => setTableOpen(false)} testID="cart-table-done" />
      </DialogFrame>
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
  below: {
    flex: layout.portraitCartFlex,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
  },
  sheet: {
    flexShrink: 1,
  },
  header: {
    gap: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.border,
  },
  headerSide: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  headerSheet: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.orderTitle,
    color: colors.text,
    flexShrink: 1,
  },
  titleSpacer: {
    flex: 1,
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
    backgroundColor: colors.accent,
  },
  squareScaled: {
    transform: [{ scale: pressedScale }],
  },
  disabled: {
    opacity: opacity.disabled,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  halfButton: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  buttonError: {
    borderColor: colors.danger,
  },
  scrollFill: {
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
  lines: {
    gap: spacing.sm,
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
    backgroundColor: colors.greenSoft,
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
  summary: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.subtle,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
  },
  discountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  discountLabel: {
    ...typography.label,
    color: colors.dangerText,
  },
  discountActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  discountButton: {
    paddingHorizontal: spacing.md,
  },
  totalBox: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.greenChip,
    backgroundColor: colors.surface,
  },
  applied: {
    ...typography.label,
    color: colors.greenHover,
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
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
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
  dialogTitle: {
    ...typography.title,
    color: colors.text,
  },
});
