import { useRef } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { IconName } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/constants/theme';
import {
  REORDER_LEVEL_MAX,
  WASTAGE_PICKS,
  type ReorderLevelDialogState,
  type StockDialogKind,
  type StockDialogState,
} from '@/hooks/inventory/useInventoryActions';
import { STOCK_LIMITS } from '@/hooks/menu/useStockAdjustment';
import type { InventoryItem } from '@/services/types';
import { formatCount } from '@/utils/numbers';

const DIALOG: Record<StockDialogKind, { title: string; confirm: string; icon: IconName; qtyLabel: string; placeholder: string }> = {
  receipt: { title: 'Stock in', confirm: 'Save stock in', icon: 'arrow-down-circle-outline', qtyLabel: 'Quantity received', placeholder: 'e.g. 24' },
  count: { title: 'Count', confirm: 'Save count', icon: 'clipboard-outline', qtyLabel: 'Counted quantity on hand', placeholder: 'e.g. 33' },
  wastage: { title: 'Wastage', confirm: 'Save wastage', icon: 'trash-outline', qtyLabel: 'Quantity wasted', placeholder: 'e.g. 2' },
};

/**
 * The Stock in, Count and Wastage dialogs (Inventory → Product detail → Actions):
 * - Stock in: quantity, unit cost in pesos (prefilled from the product cost), optional note.
 * - Count: counted quantity and a reason.
 * - Wastage: quantity and a reason quick pick (`Other…` asks for the reason).
 * After a network error the fields lock and the button becomes **Retry** (the same body).
 */
export function StockMovementDialog({ dialog, item }: { dialog: StockDialogState; item: InventoryItem }) {
  const copy = DIALOG[dialog.kind];
  const testID = `stock-${dialog.kind}-dialog`;
  const editable = !dialog.busy && !dialog.locked;
  const fields = dialog.fields;
  const costRef = useRef<TextInput>(null);
  const reasonRef = useRef<TextInput>(null);
  const hasReasonField = dialog.kind !== 'wastage' || fields.pick === 'other';
  const submit = () => {
    if (editable) dialog.submit();
  };
  // Keyboard "Next": qty → unit cost (stock in) → reason; the last field's "Done" saves.
  const afterQty = dialog.kind === 'receipt' ? costRef : hasReasonField ? reasonRef : null;

  return (
    <ConfirmDialog
      visible={dialog.visible}
      title={copy.title}
      message={`${item.name}: ${formatCount(item.qty)} on hand.`}
      confirmLabel={dialog.locked ? 'Retry' : copy.confirm}
      icon={copy.icon}
      confirmVariant={dialog.kind === 'wastage' ? 'danger' : 'primary'}
      busy={dialog.busy}
      error={dialog.banner}
      onConfirm={dialog.submit}
      onCancel={dialog.cancel}
      testID={testID}
    >
      <Input
        label={copy.qtyLabel}
        value={fields.qty}
        onChangeText={dialog.setQty}
        placeholder={copy.placeholder}
        keyboardType="number-pad"
        maxLength={String(STOCK_LIMITS.maxQty).length}
        error={dialog.errors.qty}
        editable={editable}
        returnKeyType={afterQty ? 'next' : 'done'}
        submitBehavior={afterQty ? 'submit' : 'blurAndSubmit'}
        onSubmitEditing={() => (afterQty ? afterQty.current?.focus() : submit())}
        testID={`${testID}-qty`}
      />
      {dialog.kind === 'receipt' ? (
        <Input
          label="Unit cost"
          prefix="₱"
          value={fields.unitCost}
          onChangeText={dialog.setUnitCost}
          placeholder="0.00"
          keyboardType="decimal-pad"
          error={dialog.errors.unitCost}
          editable={editable}
          ref={costRef}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => reasonRef.current?.focus()}
          testID={`${testID}-cost`}
        />
      ) : null}
      {dialog.kind === 'wastage' ? (
        <View style={styles.picks}>
          <Text style={styles.label}>Reason</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {WASTAGE_PICKS.map((pick) => (
              <ChoiceChip
                key={pick.value}
                label={pick.label}
                selected={fields.pick === pick.value}
                onPress={() => dialog.setPick(pick.value)}
                disabled={!editable}
                testID={`${testID}-pick-${pick.value}`}
              />
            ))}
          </View>
          {fields.pick !== 'other' && dialog.errors.reason ? (
            <Text style={styles.error} testID={`${testID}-reason-error`}>
              {dialog.errors.reason}
            </Text>
          ) : null}
        </View>
      ) : null}
      {hasReasonField ? (
        <Input
          label={dialog.kind === 'receipt' ? 'Note (optional)' : dialog.kind === 'wastage' ? 'Other reason' : 'Reason'}
          value={fields.reason}
          onChangeText={dialog.setReason}
          placeholder={dialog.kind === 'receipt' ? 'e.g. Delivery' : dialog.kind === 'count' ? 'e.g. Weekly count' : 'e.g. Dropped'}
          maxLength={STOCK_LIMITS.reasonMax}
          error={dialog.errors.reason}
          editable={editable}
          ref={reasonRef}
          returnKeyType="done"
          onSubmitEditing={submit}
          testID={`${testID}-reason`}
        />
      ) : null}
    </ConfirmDialog>
  );
}

/** The reorder level dialog: the number (0–100000) with Save, and **Remove** (no alert). */
export function ReorderLevelDialog({ dialog, item }: { dialog: ReorderLevelDialogState; item: InventoryItem }) {
  return (
    <ConfirmDialog
      visible={dialog.visible}
      title="Reorder level"
      message={`${item.name} shows as Low at or below this quantity.`}
      confirmLabel="Save"
      icon="notifications-outline"
      busy={dialog.busy === 'save'}
      confirmDisabled={dialog.busy !== null}
      error={dialog.banner}
      onConfirm={dialog.save}
      onCancel={dialog.cancel}
      testID="reorder-dialog"
    >
      <Input
        label="Reorder level"
        value={dialog.text}
        onChangeText={dialog.setText}
        placeholder="e.g. 10"
        keyboardType="number-pad"
        maxLength={String(REORDER_LEVEL_MAX).length}
        error={dialog.error}
        editable={dialog.busy === null}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (dialog.busy === null) dialog.save();
        }}
        testID="reorder-dialog-level"
      />
      {dialog.canRemove ? (
        <Button
          title="Remove reorder level"
          leftIcon="notifications-off-outline"
          variant="ghost"
          onPress={dialog.remove}
          loading={dialog.busy === 'remove'}
          disabled={dialog.busy !== null}
          testID="reorder-dialog-remove"
        />
      ) : null}
    </ConfirmDialog>
  );
}

const styles = StyleSheet.create({
  picks: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  error: {
    ...typography.caption,
    color: colors.dangerText,
  },
});
