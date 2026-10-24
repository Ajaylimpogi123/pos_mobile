import { StyleSheet, Text, View } from 'react-native';

import { DiscountFields } from '@/components/sell/DiscountFields';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/constants/theme';
import { parseQty, type CartEditors } from '@/hooks/sell/useCartEditors';
import { useResponsive } from '@/hooks/useResponsive';
import { CART_LIMITS } from '@/stores/cart';
import { formatPeso } from '@pos/core/money';

type LineEditorDialogProps = {
  editors: CartEditors;
};

/**
 * Edit one cart line: the quantity (stepper or typed, 1–999), a line
 * discount, and a note for the kitchen (max 120), or remove it. Changes are
 * applied only on Save; the draft lives in `useCartEditors`, so rotating keeps it.
 */
export function LineEditorDialog({ editors }: LineEditorDialogProps) {
  const { isSmallPhone } = useResponsive();
  const draft = editors.lineDraft;
  const qty = draft ? parseQty(draft.qty) : null;

  return (
    <DialogFrame visible={draft !== null} onRequestClose={editors.cancelLine} testID="line-editor">
      {draft ? (
        <>
          <View style={styles.titles}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
              {draft.name}
            </Text>
            <Text style={styles.subtitle}>{formatPeso(draft.unitPriceCents)} each</Text>
          </View>

          <View style={styles.qtyRow}>
            <IconButton
              icon="remove"
              variant="soft"
              accessibilityLabel="Decrease quantity"
              onPress={() => editors.changeLineDraft({ qty: String(Math.max(1, (qty ?? 2) - 1)) })}
              disabled={qty !== null && qty <= 1}
              testID="line-editor-qty-minus"
            />
            <View style={styles.qtyInput}>
              <Input
                label="Quantity"
                value={draft.qty}
                onChangeText={(text) => editors.changeLineDraft({ qty: text.replace(/[^0-9]/g, '') })}
                keyboardType="number-pad"
                maxLength={3}
                error={draft.errors.qty}
                testID="line-editor-qty"
              />
            </View>
            <IconButton
              icon="add"
              variant="soft"
              accessibilityLabel="Increase quantity"
              onPress={() => editors.changeLineDraft({ qty: String(Math.min(CART_LIMITS.maxQty, (qty ?? 0) + 1)) })}
              disabled={qty !== null && qty >= CART_LIMITS.maxQty}
              testID="line-editor-qty-plus"
            />
          </View>

          {draft.discountLock ? (
            // Senior Citizen / PWD Discount: no double discount on this line.
            <Chip label={draft.discountLock} variant="neutral" icon="id-card-outline" testID="line-editor-sc-pwd-lock" />
          ) : (
            <DiscountFields
              draft={draft.discount}
              onChange={(discount) => editors.changeLineDraft({ discount })}
              error={draft.errors.discount}
              toggleLabel="Line discount"
              testIDPrefix="line-discount"
            />
          )}

          <Input
            label="Note for the kitchen (optional)"
            value={draft.notes}
            onChangeText={(notes) => editors.changeLineDraft({ notes })}
            placeholder="e.g. No ketchup"
            maxLength={CART_LIMITS.lineNotesMax}
            testID="line-editor-notes"
          />

          <View style={[styles.actions, isSmallPhone && styles.actionsStacked]}>
            <Button
              title="Remove"
              leftIcon="trash-outline"
              variant="danger"
              onPress={editors.removeDraftLine}
              style={styles.action}
              testID="line-editor-remove"
            />
            <Button title="Cancel" variant="secondary" onPress={editors.cancelLine} style={styles.action} testID="line-editor-cancel" />
            <Button title="Save" onPress={editors.saveLine} style={styles.action} testID="line-editor-save" />
          </View>
        </>
      ) : null}
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  titles: {
    gap: spacing.xxs,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  qtyInput: {
    flex: 1,
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
