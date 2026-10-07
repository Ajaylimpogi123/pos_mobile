import { StyleSheet, Text, View } from 'react-native';

import { ApproverPanel } from '@/components/pin/ApproverPanel';
import { PrintJobRows } from '@/components/printing/PrintJobRows';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { IconBadge } from '@/components/ui/IconBadge';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/constants/theme';
import type { VoidOrderState } from '@/hooks/orders/useVoidOrder';
import { useResponsive } from '@/hooks/useResponsive';
import { orderNumberLabel } from '@/sale/localOrder';
import { REVERSAL_REASON_MAX } from '@/sale/refunds';
import { OTHER_REASON, VOID_REASONS } from '@/sale/reversals';
import type { PrintableOrder } from '@/services/types';
import { formatPeso } from '@/utils/money';

type VoidDialogProps = {
  order: PrintableOrder;
  voiding: VoidOrderState;
};

const REASON_CHOICES = [...VOID_REASONS, OTHER_REASON];

/** The void's result: what to give back, and the void slip and VOID tickets as they print. */
function VoidDoneView({ voiding }: { voiding: VoidOrderState }) {
  const done = voiding.done;
  if (!done) return null;
  return (
    <View style={styles.section} testID="void-done">
      {done.lines.map((line, index) => (
        <Text key={line} style={index === 0 ? styles.giveBack : styles.giveBackMore} testID={`void-give-back-${index}`}>
          {line}
        </Text>
      ))}
      {done.print?.notice ? <Banner variant="warning" message={done.print.notice} testID="void-print-notice" /> : null}
      <PrintJobRows jobs={voiding.jobs} testID="void-job" />
      {done.print && done.print.unrouted.length > 0 ? (
        <View style={styles.unrouted} testID="void-unrouted">
          <Text style={styles.muted}>No kitchen or bar printer was told about:</Text>
          {done.print.unrouted.map((line, index) => (
            <Text key={`${line}-${index}`} style={styles.line}>
              • {line}
            </Text>
          ))}
        </View>
      ) : null}
      <Button title="Done" onPress={voiding.close} testID="void-close" />
    </View>
  );
}

/**
 * **Void sale** (Voids & Refunds, Phase 7): a required reason with quick
 * picks, a manager's approval (approver + PIN) when the user lacks
 * `sale.void`, and a destructive confirm. A lost answer locks the dialog and
 * offers Retry (the same key). After the `200` it says what to give back.
 */
export function VoidDialog({ order, voiding }: VoidDialogProps) {
  const { isCompactHeight, isSmallPhone } = useResponsive();
  const { picker } = voiding;

  return (
    <DialogFrame visible={voiding.open} onRequestClose={voiding.close} busy={voiding.submitting} testID="void-dialog">
      {isCompactHeight ? null : <IconBadge icon="close-circle-outline" tone="danger" />}
      <Text style={styles.title} accessibilityRole="header">
        {voiding.done ? 'Sale voided' : 'Void sale'}
      </Text>
      {voiding.done ? (
        <VoidDoneView voiding={voiding} />
      ) : (
        <>
          <Text style={styles.message}>
            {orderNumberLabel(order)} · {formatPeso(order.total_cents)}. The sale stays on record as voided, and its stock goes back.
          </Text>
          {voiding.banner ? (
            <Banner variant={voiding.banner.variant} message={voiding.banner.message} testID="void-banner" />
          ) : null}

          <View style={styles.section}>
            <Text style={styles.label}>Reason</Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {REASON_CHOICES.map((reason, index) => (
                <ChoiceChip
                  key={reason}
                  label={reason}
                  selected={voiding.choice === reason}
                  onPress={() => voiding.choose(reason)}
                  disabled={voiding.locked}
                  testID={`void-reason-${index}`}
                />
              ))}
            </View>
            {voiding.choice === OTHER_REASON ? (
              <Input
                label="What happened?"
                value={voiding.otherText}
                onChangeText={voiding.setOtherText}
                maxLength={REVERSAL_REASON_MAX}
                editable={!voiding.locked}
                error={voiding.reasonError}
                testID="void-reason-text"
              />
            ) : voiding.reasonError ? (
              <Text style={styles.error} testID="void-reason-error">
                {voiding.reasonError}
              </Text>
            ) : null}
          </View>

          {voiding.needsApproval ? (
            <View style={styles.section} testID="void-approval">
              <Text style={styles.label}>Manager approval</Text>
              <Text style={styles.hint}>{picker.approval.reason ?? 'A manager must approve this void with their PIN.'}</Text>
              <ApproverPanel
                approval={picker.approval}
                approvers={picker.approvers}
                loading={picker.approversLoading}
                loadError={picker.approversError}
                onRetry={picker.retryApprovers}
                onChoose={picker.chooseApprover}
                onBack={picker.backToApprovers}
                onPinChange={picker.setApprovalPin}
                disabled={voiding.locked}
                emptyText="No one with a PIN can approve voids. Ask a manager to set a PIN."
                testIDPrefix="void-approval"
              />
            </View>
          ) : null}

          <View style={[styles.actions, isSmallPhone && styles.actionsStacked]}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={voiding.close}
              disabled={voiding.submitting}
              style={styles.action}
              testID="void-cancel"
            />
            <Button
              title={voiding.awaiting ? 'Retry' : 'Void sale'}
              leftIcon={voiding.awaiting ? 'refresh' : 'close-circle-outline'}
              variant="danger"
              onPress={voiding.confirm}
              loading={voiding.submitting}
              disabled={!voiding.canConfirm}
              style={styles.action}
              testID="void-confirm"
            />
          </View>
        </>
      )}
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
  },
  section: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  hint: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  giveBack: {
    ...typography.heading,
    color: colors.text,
  },
  giveBackMore: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  unrouted: {
    gap: spacing.xxs,
  },
  muted: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  line: {
    ...typography.bodySm,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  actionsStacked: {
    flexDirection: 'column-reverse',
  },
  action: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
