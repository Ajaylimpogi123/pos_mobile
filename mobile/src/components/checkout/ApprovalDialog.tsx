import { StyleSheet, Text, View } from 'react-native';

import { ApproverPanel } from '@/components/pin/ApproverPanel';
import { Button } from '@/components/ui/Button';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { IconBadge } from '@/components/ui/IconBadge';
import { colors, spacing, typography } from '@/constants/theme';
import type { CheckoutState } from '@/hooks/sell/useCheckout';
import { useResponsive } from '@/hooks/useResponsive';
import { isPinComplete } from '@/utils/pin';

type ApprovalDialogProps = {
  /** The pay-now checkout, or a dine-in tab's settlement. */
  checkout: Pick<
    CheckoutState,
    | 'approval'
    | 'submitting'
    | 'approvers'
    | 'approversLoading'
    | 'approversError'
    | 'retryApprovers'
    | 'chooseApprover'
    | 'backToApprovers'
    | 'setApprovalPin'
    | 'approve'
    | 'cancelApproval'
  >;
};

const DEFAULT_REASON = 'This discount is above your limit. A manager must approve it with their PIN.';

/**
 * Manager approval of a discount: pick an approver (from `pin-users`, only
 * those with `can_approve_discounts` whose limit covers this discount), then
 * their PIN on the pad. "Approve" resubmits the sale with the same ULID.
 */
export function ApprovalDialog({ checkout }: ApprovalDialogProps) {
  const { approval, submitting } = checkout;
  const { isCompactHeight, isSmallPhone } = useResponsive();
  const pinStep = approval.step === 'pin';

  return (
    <DialogFrame visible={approval.visible} onRequestClose={checkout.cancelApproval} busy={submitting} testID="approval-dialog">
      {isCompactHeight ? null : <IconBadge icon="shield-checkmark-outline" />}
      <Text style={styles.title} accessibilityRole="header">
        Manager approval
      </Text>
      <Text style={styles.message}>{approval.reason ?? DEFAULT_REASON}</Text>
      <ApproverPanel
        approval={approval}
        approvers={checkout.approvers}
        loading={checkout.approversLoading}
        loadError={checkout.approversError}
        onRetry={checkout.retryApprovers}
        onChoose={checkout.chooseApprover}
        onBack={checkout.backToApprovers}
        onPinChange={checkout.setApprovalPin}
        disabled={submitting}
        emptyText="No one with a PIN can approve a discount this size. Lower the discount, or ask a manager to set a PIN."
        testIDPrefix="approval"
      />
      <View style={[styles.actions, isSmallPhone && styles.actionsStacked]}>
        <Button
          title="Cancel"
          variant="secondary"
          onPress={checkout.cancelApproval}
          disabled={submitting}
          style={styles.action}
          testID="approval-cancel"
        />
        {pinStep ? (
          <Button
            title="Approve"
            leftIcon="checkmark"
            onPress={checkout.approve}
            loading={submitting}
            disabled={!isPinComplete(approval.pin)}
            style={styles.action}
            testID="approval-submit"
          />
        ) : null}
      </View>
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
