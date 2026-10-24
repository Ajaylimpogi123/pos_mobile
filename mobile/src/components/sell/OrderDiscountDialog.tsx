import { StyleSheet, Text, View } from 'react-native';

import { DiscountFields } from '@/components/sell/DiscountFields';
import { Button } from '@/components/ui/Button';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { colors, spacing, typography } from '@/constants/theme';
import type { CartEditors } from '@/hooks/sell/useCartEditors';
import { useResponsive } from '@/hooks/useResponsive';
import { formatPeso } from '@pos/core/money';

type OrderDiscountDialogProps = {
  editors: CartEditors;
  /** `B`: what the order discount applies to (the lines after their own discounts). */
  baseCents: number;
  /** A discount is already set: offer to remove it. */
  hasDiscount: boolean;
};

/** Set, change or remove the order discount. It applies to the lines after their own discounts. */
export function OrderDiscountDialog({ editors, baseCents, hasDiscount }: OrderDiscountDialogProps) {
  const { isSmallPhone } = useResponsive();
  const draft = editors.orderDraft;

  return (
    <DialogFrame visible={draft !== null} onRequestClose={editors.cancelOrderDiscount} testID="order-discount-dialog">
      {draft ? (
        <>
          <Text style={styles.title} accessibilityRole="header">
            Order discount
          </Text>
          <Text style={styles.message}>Applies to {formatPeso(baseCents)}, after any line discounts.</Text>
          <DiscountFields
            draft={draft.discount}
            onChange={editors.changeOrderDraft}
            error={draft.error}
            testIDPrefix="order-discount"
          />
          <View style={[styles.actions, isSmallPhone && styles.actionsStacked]}>
            {hasDiscount ? (
              <Button
                title="Remove"
                leftIcon="trash-outline"
                variant="danger"
                onPress={editors.removeOrderDiscount}
                style={styles.action}
                testID="order-discount-remove"
              />
            ) : null}
            <Button
              title="Cancel"
              variant="secondary"
              onPress={editors.cancelOrderDiscount}
              style={styles.action}
              testID="order-discount-cancel"
            />
            <Button title="Apply" onPress={editors.saveOrderDiscount} style={styles.action} testID="order-discount-save" />
          </View>
        </>
      ) : null}
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
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionsStacked: {
    flexDirection: 'column-reverse',
  },
  action: {
    flexGrow: 1,
  },
});
