import { StyleSheet, Text, View } from 'react-native';

import { SectionLabel } from '@/components/checkout/PaymentsCard';
import { ScPwdAmountRows } from '@/components/sell/ScPwdAmountRows';
import { AmountRow } from '@/components/shared/AmountRow';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { showVatBreakdown } from '@/constants/features';
import { colors, numeric, radius, sizes, spacing, typography } from '@/constants/theme';
import { describeDiscount } from '@/sale/discountRules';
import { VAT_RATE_BPS, type SalePricing } from '@/sale/pricing';
import { describeScPwd } from '@/sale/scPwd';
import type { SaleDiscount, ScPwdRequest } from '@/services/types';
import type { CartCustomer, CartLine } from '@/stores/cart';
import { formatPeso } from '@/utils/money';
import { formatPercentBps } from '@/utils/numbers';

type SaleSummaryCardProps = {
  lines: readonly CartLine[];
  orderDiscount: SaleDiscount | null;
  customer: CartCustomer | null;
  pricing: SalePricing;
  /** Senior Citizen / PWD Discount: the cart's SC/PWD, or `null`. */
  scPwd?: ScPwdRequest | null;
  /** Opens the SC/PWD sheet (not given: no SC/PWD action). */
  onEditScPwd?: () => void;
  /** The SC/PWD action is disabled (a sale attempt in flight or unconfirmed). */
  scPwdDisabled?: boolean;
  /** The SC/PWD message to show (a rule the cart breaks, or the server's). */
  scPwdError?: string | null;
};

/**
 * What is being charged (Checkout board → Order summary): the lines
 * (`2×  Name  ₱290.00`), then subtotal, discounts and the total, then the
 * VAT breakdown (VATable sales, VAT, VAT-exempt sales; only while
 * `SHOW_VAT_BREAKDOWN` is on, see `constants/features.ts`), all from the same
 * pricing the server runs. Senior Citizen / PWD Discount: an `SC/PWD` chip on
 * marked lines, the SC/PWD row (it opens the sheet) and its amounts
 * (`VAT exempted` only when VAT exempt is ticked). SC/PWD never needs approval.
 */
export function SaleSummaryCard({
  lines,
  orderDiscount,
  customer,
  pricing,
  scPwd = null,
  onEditScPwd,
  scPwdDisabled = false,
  scPwdError = null,
}: SaleSummaryCardProps) {
  const itemsMode = scPwd?.mode === 'items';
  return (
    <View style={styles.card} testID="checkout-summary">
      <View style={styles.header}>
        <SectionLabel>Order summary</SectionLabel>
        {customer ? (
          <Text style={styles.customer} numberOfLines={1} testID="checkout-customer">
            {customer.full_name}
          </Text>
        ) : null}
      </View>

      <View>
        {lines.map((line, index) => {
          const priced = pricing.lines[index];
          return (
            <View key={line.key} style={styles.line} testID={`checkout-line-${index}`}>
              <Text style={styles.qty}>{line.qty}×</Text>
              <View style={styles.lineText}>
                <Text style={styles.lineName} numberOfLines={2}>
                  {line.product.name}
                </Text>
                {itemsMode && line.scPwd ? (
                  <Chip label="SC/PWD" variant="info" icon="id-card-outline" testID={`checkout-line-${index}-sc-pwd`} />
                ) : null}
                {line.discount ? (
                  <Text style={styles.lineMeta}>
                    {describeDiscount(line.discount)} · −{formatPeso(priced?.line_discount_cents ?? 0)}
                  </Text>
                ) : null}
                {line.notes ? <Text style={styles.lineMeta}>“{line.notes}”</Text> : null}
              </View>
              <Text style={styles.lineAmount} numberOfLines={1}>
                {formatPeso(priced?.net_cents ?? 0)}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.rows}>
        <AmountRow label="Subtotal" cents={pricing.subtotal_cents} variant="summary" testID="checkout-subtotal" />
        {pricing.line_discounts_cents > 0 ? (
          <AmountRow
            label="Line discounts"
            cents={pricing.line_discounts_cents}
            deduction
            variant="summary"
            testID="checkout-line-discounts"
          />
        ) : null}
        {orderDiscount ? (
          <AmountRow
            label="Order discount"
            detail={describeDiscount(orderDiscount)}
            cents={pricing.order_discount_cents}
            deduction
            variant="summary"
            testID="checkout-order-discount"
          />
        ) : null}
        {scPwd ? (
          <ScPwdAmountRows
            vatExempt={scPwd.vat_exempt}
            reliefCents={pricing.sc_pwd_vat_relief_cents}
            discountCents={pricing.sc_pwd_discount_cents}
            testIDPrefix="checkout"
            variant="summary"
          />
        ) : null}
        <View style={styles.totalRow}>
          <AmountRow label="Total" cents={pricing.total_cents} variant="total" testID="checkout-total" />
        </View>
      </View>

      {onEditScPwd ? (
        <View style={styles.scPwd}>
          <View style={styles.scPwdRow}>
            <View style={styles.lineText}>
              <Text style={styles.scPwdTitle}>Senior citizen / PWD</Text>
              <Text style={styles.lineMeta} testID="checkout-sc-pwd">
                {scPwd ? `${describeScPwd(scPwd)}${scPwd.vat_exempt ? ' · VAT exempt' : ''}` : 'None'}
              </Text>
            </View>
            <Button
              title={scPwd ? 'Edit' : 'Add'}
              leftIcon="id-card-outline"
              variant={scPwd ? 'tonal' : 'secondary'}
              onPress={onEditScPwd}
              disabled={scPwdDisabled}
              accessibilityLabel={scPwd ? 'Edit SC/PWD' : 'Add SC/PWD'}
              testID="checkout-sc-pwd-edit"
            />
          </View>
          {scPwdError ? (
            <Text style={styles.error} testID="checkout-sc-pwd-error">
              {scPwdError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {showVatBreakdown() ? (
        <View style={[styles.rows, styles.vat]} testID="checkout-vat">
          <AmountRow label="VATable sales" cents={pricing.vatable_sales_cents} variant="muted" testID="checkout-vatable" />
          <AmountRow
            label={`VAT (${formatPercentBps(VAT_RATE_BPS, 0)})`}
            cents={pricing.vat_amount_cents}
            variant="muted"
            testID="checkout-vat-amount"
          />
          <AmountRow label="VAT-exempt sales" cents={pricing.vat_exempt_sales_cents} variant="muted" testID="checkout-vat-exempt" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  customer: {
    ...typography.label,
    color: colors.primaryDark,
    flexShrink: 1,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.divider,
  },
  qty: {
    ...typography.controlStrong,
    ...numeric,
    color: colors.textSecondary,
    minWidth: spacing.xxl + spacing.xs,
  },
  lineText: {
    flex: 1,
    gap: spacing.xxs,
  },
  lineName: {
    ...typography.navItem,
    color: colors.text,
  },
  lineMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  lineAmount: {
    ...typography.controlStrong,
    ...numeric,
    color: colors.text,
  },
  rows: {
    gap: spacing.sm,
  },
  totalRow: {
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  scPwd: {
    gap: spacing.xs,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  scPwdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  scPwdTitle: {
    ...typography.controlStrong,
    color: colors.text,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  vat: {
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
});
