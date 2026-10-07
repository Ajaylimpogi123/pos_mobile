import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { IconBadge } from '@/components/ui/IconBadge';
import { colors, spacing, typography } from '@/constants/theme';
import type { ReprintState } from '@/hooks/orders/useReprint';
import { useResponsive } from '@/hooks/useResponsive';
import { formatBusinessDate } from '@/utils/dates';
import { formatPeso } from '@/utils/money';

type ReprintDialogProps = {
  reprint: ReprintState;
};

/**
 * "Reprint": the receipt, or the kitchen tickets (all stations), and for a
 * voided or refunded sale (Phase 7) the void slip or each refund's slip.
 * Printed copies say `*** REPRINT ***`.
 */
export function ReprintDialog({ reprint }: ReprintDialogProps) {
  const { isCompactHeight } = useResponsive();
  const manyRefunds = reprint.refunds.length > 1;

  return (
    <DialogFrame visible={reprint.open} onRequestClose={reprint.cancel} busy={reprint.busy} testID="reprint-dialog">
      {isCompactHeight ? null : <IconBadge icon="print-outline" />}
      <Text style={styles.title} accessibilityRole="header">
        Reprint
      </Text>
      <Text style={styles.message}>What should print again? Every copy is marked *** REPRINT ***.</Text>
      <View style={styles.actions}>
        <Button
          title="Receipt"
          leftIcon="receipt-outline"
          onPress={reprint.reprintReceipt}
          disabled={reprint.busy}
          testID="reprint-receipt"
        />
        <Button
          title="Kitchen tickets"
          leftIcon="restaurant-outline"
          variant="secondary"
          onPress={reprint.reprintTickets}
          disabled={reprint.busy}
          testID="reprint-kitchen"
        />
        {reprint.canReprintVoidSlip ? (
          <Button
            title="Void slip"
            leftIcon="close-circle-outline"
            variant="secondary"
            onPress={reprint.reprintVoidSlip}
            disabled={reprint.busy}
            testID="reprint-void-slip"
          />
        ) : null}
        {reprint.refunds.map((refund, index) => (
          <Button
            key={refund.ulid}
            title={
              manyRefunds
                ? `Refund slip · ${formatPeso(refund.amount_cents)} · ${formatBusinessDate(refund.business_date)}`
                : 'Refund slip'
            }
            leftIcon="return-down-back-outline"
            variant="secondary"
            onPress={() => reprint.reprintRefundSlip(refund)}
            disabled={reprint.busy}
            testID={`reprint-refund-slip-${index}`}
          />
        ))}
        <Button title="Cancel" variant="ghost" onPress={reprint.cancel} disabled={reprint.busy} testID="reprint-cancel" />
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
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
