import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AmountRow } from '@/components/shared/AmountRow';
import { colors, numeric, sizes, spacing, typography } from '@/constants/theme';
import { varianceWord } from '@pos/core/printing/documents/shiftRead';
import { paymentMethodLabel } from '@pos/core/sale/payments';
import { cashRefundsOf } from '@/shifts/shiftReport';
import type { ShiftReport } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatCount } from '@pos/core/numbers';

type ShiftReportViewProps = {
  report: ShiftReport;
  openingFloatCents: number;
  /** `null` while the shift is open. */
  countedCashCents: number | null;
  testID: string;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function CountRow({ label, value, testID }: { label: string; value: number; testID?: string }) {
  return (
    <View style={styles.countRow} accessible accessibilityLabel={`${label}: ${formatCount(value)}`}>
      <Text style={styles.countLabel}>{label}</Text>
      <Text style={styles.countValue} testID={testID}>
        {formatCount(value)}
      </Text>
    </View>
  );
}

/** "Short ₱50.00" / "Over ₱20.00" / "Balanced", in words and colour (the colour is never the only cue). */
export function VarianceLine({ varianceCents, testID }: { varianceCents: number; testID?: string }) {
  const word = varianceWord(varianceCents);
  const tone = varianceCents < 0 ? styles.short : varianceCents > 0 ? styles.over : styles.balanced;
  const text = varianceCents === 0 ? word : `${word} ${formatPeso(Math.abs(varianceCents))}`;
  return (
    <View style={styles.varianceRow} accessible accessibilityLabel={`Variance: ${text}`}>
      <Text style={styles.varianceLabel}>Variance</Text>
      <Text style={[styles.varianceValue, tone]} testID={testID}>
        {text}
      </Text>
    </View>
  );
}

/** "2 refunds · Cash ₱33.69 · GCash ₱0.00". */
function refundDetail(report: ShiftReport): string {
  const count = report.refunds_count ?? 0;
  const methods = (report.refunds_by_method ?? []).map((method) => `${paymentMethodLabel(method.method)} ${formatPeso(method.amount_cents)}`);
  return [`${formatCount(count)} ${count === 1 ? 'refund' : 'refunds'}`, ...methods].join(' · ');
}

/**
 * A `ShiftReport` on screen (the X-read dialog, the close dialog and the
 * Shifts detail): sales, payments, the cash drawer (expected cash, and once
 * counted the variance), and the cashiers. Every figure is a report field,
 * formatted from integer centavos.
 */
export function ShiftReportView({ report, openingFloatCents, countedCashCents, testID }: ShiftReportViewProps) {
  const cashSales = report.by_payment_method.find((method) => method.method === 'cash')?.amount_cents ?? 0;

  return (
    <View style={styles.container} testID={testID}>
      <Section title="Sales">
        <CountRow label="Orders" value={report.orders_count} testID={`${testID}-orders`} />
        <CountRow label="Items sold" value={report.items_sold} />
        <AmountRow label="Gross sales" cents={report.gross_sales_cents} />
        <AmountRow label="Discounts" cents={report.discounts_cents} deduction />
        {/* Senior Citizen / PWD Discount: part of Discounts. */}
        {(report.sc_pwd_vat_relief_cents ?? 0) !== 0 ? (
          <AmountRow
            label="VAT exempted (SC/PWD)"
            cents={report.sc_pwd_vat_relief_cents}
            deduction
            variant="muted"
            testID={`${testID}-sc-pwd-vat`}
          />
        ) : null}
        <AmountRow
          label="SC/PWD discount"
          detail={`${formatCount(report.sc_pwd_orders_count ?? 0)} SC/PWD ${report.sc_pwd_orders_count === 1 ? 'sale' : 'sales'}`}
          cents={report.sc_pwd_discount_cents ?? 0}
          deduction
          variant="muted"
          testID={`${testID}-sc-pwd`}
        />
        {/* Dine-in Tables & Tabs: on its own row (Net sales includes it). */}
        {(report.service_charge_cents ?? 0) !== 0 ? (
          <AmountRow label="Service charge" cents={report.service_charge_cents} testID={`${testID}-service-charge`} />
        ) : null}
        <AmountRow label="Net sales" cents={report.net_sales_cents} variant="total" testID={`${testID}-net`} />
        <AmountRow label="VATable sales" cents={report.vatable_sales_cents} variant="muted" />
        <AmountRow label="VAT" cents={report.vat_amount_cents} variant="muted" />
        <AmountRow label="VAT-exempt sales" cents={report.vat_exempt_sales_cents} variant="muted" />
      </Section>

      <Section title="Voids and refunds">
        <AmountRow
          label="Voids"
          detail={`${formatCount(report.voids_count ?? 0)} ${report.voids_count === 1 ? 'sale' : 'sales'}`}
          cents={report.voids_cents ?? 0}
          testID={`${testID}-voids`}
        />
        <AmountRow
          label="Refunds"
          detail={refundDetail(report)}
          cents={report.refunds_cents ?? 0}
          deduction
          testID={`${testID}-refunds`}
        />
        <AmountRow
          label="Net after refunds"
          cents={report.net_after_refunds_cents ?? report.net_sales_cents}
          variant="total"
          testID={`${testID}-net-after-refunds`}
        />
      </Section>

      <Section title="Payments">
        {report.by_payment_method.map((method) => (
          <AmountRow
            key={method.method}
            label={paymentMethodLabel(method.method)}
            detail={`${formatCount(method.orders_count)} ${method.orders_count === 1 ? 'order' : 'orders'}`}
            cents={method.amount_cents}
            testID={`${testID}-payment-${method.method}`}
          />
        ))}
      </Section>

      <Section title="Cash drawer">
        <AmountRow label="Opening float" cents={openingFloatCents} />
        <AmountRow label="Cash sales (after change)" cents={cashSales} />
        <AmountRow label="Cash in" cents={report.cash_in_cents} testID={`${testID}-cash-in`} />
        <AmountRow label="Cash out" cents={report.cash_out_cents} deduction testID={`${testID}-cash-out`} />
        <AmountRow label="Cash refunds" cents={cashRefundsOf(report)} deduction testID={`${testID}-cash-refunds`} />
        <AmountRow label="Expected cash" cents={report.expected_cash_cents} variant="strong" testID={`${testID}-expected`} />
        {countedCashCents !== null ? <AmountRow label="Counted cash" cents={countedCashCents} testID={`${testID}-counted`} /> : null}
        {report.variance_cents !== null ? <VarianceLine varianceCents={report.variance_cents} testID={`${testID}-variance`} /> : null}
      </Section>

      {report.by_cashier.length > 0 ? (
        <Section title="Cashiers">
          {report.by_cashier.map((cashier) => (
            <AmountRow
              key={cashier.user_id}
              label={cashier.name}
              detail={`${formatCount(cashier.orders_count)} ${cashier.orders_count === 1 ? 'order' : 'orders'}`}
              cents={cashier.net_sales_cents}
              testID={`${testID}-cashier-${cashier.user_id}`}
            />
          ))}
        </Section>
      ) : null}

      {report.needs_review_count > 0 ? (
        <CountRow label="Offline sales to review" value={report.needs_review_count} testID={`${testID}-needs-review`} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
  },
  sectionTitle: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  countLabel: {
    ...typography.body,
    color: colors.text,
    flexShrink: 1,
  },
  countValue: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  varianceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  varianceLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  varianceValue: {
    ...typography.bodyStrong,
    ...numeric,
  },
  short: {
    color: colors.dangerText,
  },
  over: {
    color: colors.warningText,
  },
  balanced: {
    color: colors.successText,
  },
});
