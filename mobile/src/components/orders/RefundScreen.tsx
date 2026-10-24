import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApproverPanel } from '@/components/pin/ApproverPanel';
import { PrintJobRows } from '@/components/printing/PrintJobRows';
import { AmountRow } from '@/components/shared/AmountRow';
import { FormFooter } from '@/components/shared/FormFooter';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TopBar } from '@/components/ui/TopBar';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { Screen } from '@/components/ui/Screen';
import { showVatBreakdown } from '@pos/core/features';
import { colors, layout, sizes, spacing, typography } from '@/constants/theme';
import { orderRoute, ROUTES } from '@/constants/routes';
import type { RefundScreenState } from '@/hooks/orders/useRefundScreen';
import { useResponsive } from '@/hooks/useResponsive';
import { orderNumberLabel } from '@/sale/localOrder';
import { VAT_RATE_BPS } from '@pos/core/sale/pricing';
import { REFUND_REFERENCE_MAX, remainingQty, REVERSAL_REASON_MAX } from '@pos/core/sale/refunds';
import type { Order } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { goBackOr } from '@/utils/navigation';
import { formatPercentBps } from '@pos/core/numbers';

type RefundScreenProps = {
  refund: RefundScreenState;
  order: Order;
};

function LinesCard({ refund, order }: RefundScreenProps) {
  return (
    <Card style={styles.card} testID="refund-lines">
      <View style={styles.cardHeader}>
        <Text style={styles.heading} accessibilityRole="header">
          What goes back
        </Text>
        <Button
          title="Refund everything"
          leftIcon="checkmark-done-outline"
          variant="secondary"
          onPress={refund.refundEverything}
          disabled={refund.locked}
          testID="refund-everything"
        />
      </View>
      {refund.serverErrors.items ? <Banner message={refund.serverErrors.items} testID="refund-items-error" /> : null}
      {refund.lines.map((item, index) => {
        const left = remainingQty(item);
        const qty = refund.selection[item.id] ?? 0;
        const priced = refund.pricing.lines.find((line) => line.item.id === item.id);
        const error = refund.serverErrors.lines[item.id];
        return (
          <View key={item.id} style={[styles.line, index > 0 && styles.divider]} testID={`refund-line-${item.id}`}>
            <View style={styles.lineText}>
              <Text style={styles.lineName} numberOfLines={2}>
                {item.product_name}
              </Text>
              <Text style={styles.meta}>
                {left} of {item.qty} left · line total {formatPeso(item.line_total_cents)}
                {item.refunded_qty > 0 ? ` · ${item.refunded_qty} refunded` : ''}
              </Text>
              {priced ? (
                <Text style={styles.lineAmount} testID={`refund-line-${item.id}-amount`}>
                  {formatPeso(priced.amount_cents)}
                </Text>
              ) : null}
              {error ? (
                <Text style={styles.error} testID={`refund-line-${item.id}-error`}>
                  {error}
                </Text>
              ) : null}
            </View>
            <QtyStepper
              value={qty}
              onChange={(value) => refund.setQty(item.id, value)}
              min={0}
              max={left}
              accessibilityLabel={`${item.product_name} to refund`}
              disabled={refund.locked}
              testID={`refund-qty-${item.id}`}
            />
          </View>
        );
      })}
      {order.refunded_cents > 0 ? (
        <Text style={styles.meta}>Already refunded on this sale: {formatPeso(order.refunded_cents)}</Text>
      ) : null}
    </Card>
  );
}

function AmountCard({ refund }: { refund: RefundScreenState }) {
  const { pricing } = refund;
  return (
    <Card style={styles.card} testID="refund-amount-card">
      {pricing.service_charge_cents > 0 ? (
        <AmountRow label="Service charge" cents={pricing.service_charge_cents} variant="summary" testID="refund-service-charge" />
      ) : null}
      <AmountRow label="Refund" cents={pricing.amount_cents} variant="total" testID="refund-amount" />
      {showVatBreakdown() ? (
        <View style={styles.rows}>
          <AmountRow label="VATable sales" cents={pricing.vatable_sales_cents} variant="muted" testID="refund-vatable" />
          <AmountRow label={`VAT (${formatPercentBps(VAT_RATE_BPS, 0)})`} cents={pricing.vat_amount_cents} variant="muted" testID="refund-vat" />
          <AmountRow label="VAT-exempt sales" cents={pricing.vat_exempt_sales_cents} variant="muted" testID="refund-vat-exempt" />
        </View>
      ) : null}
      {refund.serverErrors.checksum ? <Banner message={refund.serverErrors.checksum} testID="refund-checksum-error" /> : null}
    </Card>
  );
}

function SplitCard({ refund }: { refund: RefundScreenState }) {
  const errors = { ...refund.serverErrors, ...(refund.splitErrors ?? {}) };
  const gcashTyped = refund.split.gcashCents > 0;
  return (
    <Card style={styles.card} testID="refund-split">
      <View style={styles.cardHeader}>
        <Text style={styles.heading} accessibilityRole="header">
          Give back
        </Text>
        <Button title="Cash first" variant="ghost" onPress={refund.resetSplit} disabled={refund.locked} testID="refund-split-reset" />
      </View>
      <Input
        label={`Cash (up to ${formatPeso(refund.methodsLeft.cash)})`}
        value={refund.draft.cash}
        onChangeText={refund.setCash}
        prefix="₱"
        placeholder="0.00"
        keyboardType="decimal-pad"
        editable={!refund.locked && refund.methodsLeft.cash > 0}
        error={errors.cash}
        testID="refund-cash"
      />
      <Input
        label={`GCash (up to ${formatPeso(refund.methodsLeft.gcash)})`}
        value={refund.draft.gcash}
        onChangeText={refund.setGcash}
        prefix="₱"
        placeholder="0.00"
        keyboardType="decimal-pad"
        editable={!refund.locked && refund.methodsLeft.gcash > 0}
        error={errors.gcash}
        testID="refund-gcash"
      />
      {gcashTyped || errors.reference ? (
        <Input
          label="GCash reference of the transfer back"
          value={refund.draft.reference}
          onChangeText={refund.setReference}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={REFUND_REFERENCE_MAX}
          editable={!refund.locked}
          error={errors.reference}
          testID="refund-reference"
        />
      ) : null}
      {errors.general || errors.payments ? (
        <Banner message={(errors.general ?? errors.payments) as string} testID="refund-split-error" />
      ) : null}
    </Card>
  );
}

function ReasonCard({ refund }: { refund: RefundScreenState }) {
  const { picker } = refund;
  return (
    <Card style={styles.card} testID="refund-reason-card">
      {/* Q-017: the refund reason is required free text (no quick picks). */}
      <Input
        label="Reason"
        value={refund.reasonText}
        onChangeText={refund.setReasonText}
        placeholder="e.g. Wrong drink"
        maxLength={REVERSAL_REASON_MAX}
        editable={!refund.locked}
        error={refund.reasonError}
        testID="refund-reason"
      />
      {refund.needsApproval ? (
        <View style={styles.rows} testID="refund-approval">
          <Text style={styles.label}>Manager approval</Text>
          <Text style={styles.meta}>{picker.approval.reason ?? 'A manager must approve this refund with their PIN.'}</Text>
          <ApproverPanel
            approval={picker.approval}
            approvers={picker.approvers}
            loading={picker.approversLoading}
            loadError={picker.approversError}
            onRetry={picker.retryApprovers}
            onChoose={picker.chooseApprover}
            onBack={picker.backToApprovers}
            onPinChange={picker.setApprovalPin}
            disabled={refund.locked}
            emptyText="No one with a PIN can approve refunds. Ask a manager to set a PIN."
            testIDPrefix="refund-approval"
          />
        </View>
      ) : null}
    </Card>
  );
}

function DoneCard({ refund }: { refund: RefundScreenState }) {
  const done = refund.done;
  if (!done) return null;
  return (
    <Card style={styles.card} testID="refund-done">
      {done.lines.map((line, index) => (
        <Text key={line} style={index === 0 ? styles.giveBack : styles.giveBackMore} testID={`refund-give-back-${index}`}>
          {line}
        </Text>
      ))}
      {done.print?.notice ? <Banner variant="warning" message={done.print.notice} testID="refund-print-notice" /> : null}
      <PrintJobRows jobs={refund.jobs} testID="refund-job" />
      <Button title="Back to the order" onPress={() => goBackOr(orderRoute(done.order.ulid))} testID="refund-finish" />
    </Card>
  );
}

/**
 * The refund screen (Voids & Refunds, Phase 7): a stepper per line with a
 * quantity left and **Refund everything**, the amount and its VAT split (only
 * while `SHOW_VAT_BREAKDOWN` is on, see `constants/features.ts`), the
 * cash / GCash split (cash first, never beyond what each method has left),
 * the reason, a manager's approval when needed, then **Refund ₱…** in the sticky footer (with Cancel). Tablet
 * landscape shows the lines beside the rest; elsewhere one centred column.
 */
export function RefundScreen({ refund, order }: RefundScreenProps) {
  const { isTwoPane, screenPaddingX, screenPaddingY, gutter } = useResponsive();
  const nothingLeft = !refund.refundable && !refund.done;

  const aside = (
    <View style={[isTwoPane ? styles.asidePane : styles.full, { gap: gutter }]}>
      <AmountCard refund={refund} />
      <SplitCard refund={refund} />
      <ReasonCard refund={refund} />
      {refund.banner ? <Banner variant={refund.banner.variant} message={refund.banner.message} testID="refund-banner" /> : null}
      {refund.blocker ? <Banner variant="warning" message={refund.blocker} testID="refund-blocker" /> : null}
    </View>
  );

  return (
    <Screen edges={[]} testID="refund-screen">
      <TopBar
        title="Refund"
        subtitle={orderNumberLabel(order)}
        left={
          <IconButton
            icon="arrow-back"
            variant="bar"
            accessibilityLabel="Back"
            onPress={() => goBackOr(ROUTES.orders)}
            disabled={refund.submitting}
            testID="refund-back"
          />
        }
        testID="refund-header"
      />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
        <KeyboardScrollView contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }} testID="refund-scroll">
          <View
            style={[
              styles.inner,
              { gap: gutter, maxWidth: isTwoPane ? layout.formWideMaxWidth : layout.receiptMaxWidth },
              isTwoPane && !refund.done && !nothingLeft ? styles.row : styles.column,
            ]}
          >
            {refund.done ? (
              <DoneCard refund={refund} />
            ) : nothingLeft ? (
              <Banner variant="info" message="Nothing is left to refund on this sale." testID="refund-nothing-left" />
            ) : (
              <>
                <View style={isTwoPane ? styles.mainPane : styles.full}>
                  <LinesCard refund={refund} order={order} />
                </View>
                {aside}
              </>
            )}
          </View>
        </KeyboardScrollView>
        {/* The sticky footer (back-office.md → Forms): Cancel and the destructive "Refund ₱…" (the label names the action). */}
        {refund.done || nothingLeft ? null : (
          <View style={[styles.footerBar, { paddingHorizontal: screenPaddingX }]} testID="refund-footer">
            <View style={[styles.footerInner, { maxWidth: isTwoPane ? layout.formWideMaxWidth : layout.receiptMaxWidth }]}>
              <FormFooter
                onCancel={() => goBackOr(ROUTES.orders)}
                cancelDisabled={refund.submitting}
                saveTitle={refund.awaiting ? 'Retry' : `Refund ${formatPeso(refund.pricing.amount_cents)}`}
                saveIcon={refund.awaiting ? 'refresh' : 'return-down-back-outline'}
                destructive
                onSave={refund.submit}
                saving={refund.submitting}
                saveDisabled={!refund.canSubmit}
                saveTestID="refund-submit"
                cancelTestID="refund-cancel"
              />
            </View>
          </View>
        )}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  footerBar: {
    paddingVertical: spacing.md,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerInner: {
    width: '100%',
    alignSelf: 'center',
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
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heading: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  rows: {
    gap: spacing.sm,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
  },
  lineText: {
    flex: 1,
    minWidth: layout.sectionTitleMinWidth,
    gap: spacing.xxs,
  },
  lineName: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  lineAmount: {
    ...typography.bodyStrong,
    color: colors.primary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  giveBack: {
    ...typography.title,
    color: colors.text,
  },
  giveBackMore: {
    ...typography.heading,
    color: colors.text,
  },
});
