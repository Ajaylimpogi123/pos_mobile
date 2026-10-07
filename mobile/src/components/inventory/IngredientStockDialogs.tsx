import { useRef } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';

import { QtyUnitField, UnitChips } from '@/components/units/QtyUnitField';
import { Button } from '@/components/ui/Button';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { IconName } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { costRateTexts, type IngredientCostDialogState } from '@/hooks/ingredients/useIngredientCost';
import {
  INGREDIENT_WASTAGE_PICKS,
  REASON_MAX,
  type AdjustDirection,
  type IngredientReorderDialogState,
  type IngredientStockDialogKind,
  type IngredientStockDialogState,
} from '@/hooks/ingredients/useIngredientStock';
import type { Ingredient } from '@/services/types';
import { formatPeso } from '@/utils/money';
import { formatQty } from '@/utils/quantity';

const DIALOG: Record<IngredientStockDialogKind, { title: string; confirm: string; icon: IconName; qtyLabel: string }> = {
  adjustment: { title: 'Adjust stock', confirm: 'Save adjustment', icon: 'swap-vertical-outline', qtyLabel: 'Quantity' },
  count: { title: 'Count', confirm: 'Save count', icon: 'clipboard-outline', qtyLabel: 'Counted quantity on hand' },
  wastage: { title: 'Wastage', confirm: 'Save wastage', icon: 'trash-outline', qtyLabel: 'Quantity wasted' },
};

const DIRECTIONS = [
  { value: 'add' as AdjustDirection, label: 'Add', icon: 'add-circle-outline' as const, testID: 'ingredient-adjust-add' },
  { value: 'remove' as AdjustDirection, label: 'Remove', icon: 'remove-circle-outline' as const, testID: 'ingredient-adjust-remove' },
];

/**
 * The ingredient Adjust, Count and Wastage dialogs (§L "adjust dialogs with a
 * unit picker"): a quantity with the unit picker and the live base preview,
 * then a reason (Wastage: the quick picks). After a network error the fields
 * lock and the button becomes **Retry** (the same body and ULID).
 */
export function IngredientStockDialog({ dialog, item }: { dialog: IngredientStockDialogState; item: Ingredient }) {
  const copy = DIALOG[dialog.kind];
  const testID = `ingredient-${dialog.kind}-dialog`;
  const editable = !dialog.busy && !dialog.locked;
  const { fields } = dialog;
  const reasonRef = useRef<TextInput>(null);
  const showReason = dialog.kind !== 'wastage' || fields.pick === 'other';

  return (
    <ConfirmDialog
      visible={dialog.visible}
      title={copy.title}
      message={`${item.name}: ${formatQty(item.qty)} ${item.base_unit} on hand.`}
      confirmLabel={dialog.locked ? 'Retry' : copy.confirm}
      icon={copy.icon}
      confirmVariant={dialog.kind === 'wastage' ? 'danger' : 'primary'}
      busy={dialog.busy}
      confirmDisabled={dialog.choices === null}
      error={dialog.banner}
      onConfirm={dialog.submit}
      onCancel={dialog.cancel}
      testID={testID}
    >
      {dialog.kind === 'adjustment' ? (
        <SegmentedControl
          options={DIRECTIONS}
          value={fields.direction}
          onChange={dialog.setDirection}
          disabled={!editable}
          accessibilityLabel="Add or remove"
          testID={`${testID}-direction`}
        />
      ) : null}
      {dialog.choices ? (
        <QtyUnitField
          label={copy.qtyLabel}
          qty={fields.qty}
          onQtyChange={dialog.setQty}
          unit={fields.unit}
          onUnitChange={dialog.setUnit}
          choices={dialog.choices}
          error={dialog.errors.qty}
          unitError={dialog.errors.unit}
          editable={editable}
          returnKeyType={showReason ? 'next' : 'done'}
          submitBehavior={showReason ? 'submit' : undefined}
          onSubmitEditing={showReason ? () => reasonRef.current?.focus() : undefined}
          testID={testID}
        />
      ) : null}
      {dialog.kind === 'wastage' ? (
        <View style={styles.picks}>
          <Text style={styles.label}>Reason</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {INGREDIENT_WASTAGE_PICKS.map((pick) => (
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
      {showReason ? (
        <Input
          label={dialog.kind === 'wastage' ? 'Other reason' : 'Reason'}
          value={fields.reason}
          onChangeText={dialog.setReason}
          placeholder={dialog.kind === 'count' ? 'e.g. Weekly count' : dialog.kind === 'wastage' ? 'e.g. Spilled' : 'e.g. Found a missed sack'}
          maxLength={REASON_MAX}
          error={dialog.errors.reason}
          editable={editable}
          ref={reasonRef}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (editable) dialog.submit();
          }}
          testID={`${testID}-reason`}
        />
      ) : null}
    </ConfirmDialog>
  );
}

/** The ingredient reorder level: a quantity in any valid unit (Save), or **Remove** (no alert). */
export function IngredientReorderDialog({ dialog, item }: { dialog: IngredientReorderDialogState; item: Ingredient }) {
  return (
    <ConfirmDialog
      visible={dialog.visible}
      title="Reorder level"
      message={`${item.name} shows as Low at or below this quantity.`}
      confirmLabel="Save"
      icon="notifications-outline"
      busy={dialog.busy === 'save'}
      confirmDisabled={dialog.busy !== null || dialog.choices === null}
      error={dialog.banner}
      onConfirm={dialog.save}
      onCancel={dialog.cancel}
      testID="ingredient-reorder-dialog"
    >
      {dialog.choices ? (
        <QtyUnitField
          label="Reorder level"
          qty={dialog.qty}
          onQtyChange={dialog.setQty}
          unit={dialog.unit}
          onUnitChange={dialog.setUnit}
          choices={dialog.choices}
          error={dialog.errors.qty}
          unitError={dialog.errors.unit}
          editable={dialog.busy === null}
          placeholder="e.g. 5"
          testID="ingredient-reorder-dialog"
        />
      ) : null}
      {dialog.canRemove ? (
        <Button
          title="Remove reorder level"
          leftIcon="notifications-off-outline"
          variant="ghost"
          onPress={dialog.remove}
          loading={dialog.busy === 'remove'}
          disabled={dialog.busy !== null}
          testID="ingredient-reorder-dialog-remove"
        />
      ) : null}
    </ConfirmDialog>
  );
}

/**
 * **Set cost** (§D1): the price in pesos of one unit (any valid unit, default
 * the base unit), an optional reason, and the live cost per base unit with
 * the server's math. After a network error the fields lock and the button
 * becomes **Retry** (the same body and ULID).
 */
export function IngredientCostDialog({ dialog, item }: { dialog: IngredientCostDialogState; item: Ingredient }) {
  const editable = !dialog.busy && !dialog.locked;
  const { fields, preview } = dialog;
  const testID = 'ingredient-cost-dialog';
  const current = costRateTexts(item.avg_cost, item.base_unit);
  const unitLabel = fields.unit || item.base_unit;
  const reasonRef = useRef<TextInput>(null);

  return (
    <ConfirmDialog
      visible={dialog.visible}
      title="Set cost"
      message={`${item.name}: now ${current.perBase}${current.perLarger ? ` (${current.perLarger})` : ''}. Receipts keep re-weighting the cost afterwards.`}
      confirmLabel={dialog.locked ? 'Retry' : 'Save cost'}
      icon="pricetag-outline"
      busy={dialog.busy}
      confirmDisabled={dialog.choices === null}
      error={dialog.banner}
      onConfirm={dialog.submit}
      onCancel={dialog.cancel}
      testID={testID}
    >
      <Input
        label={`Cost of 1 ${unitLabel}`}
        prefix="₱"
        value={fields.amount}
        onChangeText={(text) => dialog.setAmount(text.replace(/[^0-9.,]/g, ''))}
        placeholder="e.g. 1,250.00"
        keyboardType="decimal-pad"
        maxLength={16}
        error={dialog.errors.cost_cents}
        editable={editable}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => reasonRef.current?.focus()}
        testID={`${testID}-amount`}
      />
      {dialog.choices ? (
        <View style={styles.picks}>
          <Text style={styles.label}>Per</Text>
          <UnitChips choices={dialog.choices} value={fields.unit} onChange={dialog.setUnit} disabled={!editable} testID={`${testID}-units`} />
          {dialog.errors.unit ? (
            <Text style={styles.error} accessibilityLiveRegion="polite" testID={`${testID}-unit-error`}>
              {dialog.errors.unit}
            </Text>
          ) : null}
        </View>
      ) : null}
      {preview ? (
        <View style={styles.preview} accessibilityLiveRegion="polite" testID={`${testID}-preview`}>
          <Text style={styles.previewLabel}>New cost</Text>
          <Text style={[styles.previewRate, preview.tooSmall && styles.previewRateBad]} testID={`${testID}-preview-rate`}>
            {preview.perBase}
          </Text>
          {preview.perLarger ? (
            <Text style={styles.previewMuted} testID={`${testID}-preview-larger`}>
              = {preview.perLarger}
            </Text>
          ) : null}
          {preview.valueFrom !== null && preview.valueTo !== null ? (
            <Text style={styles.previewMuted} testID={`${testID}-preview-value`}>
              Stock value {formatPeso(preview.valueFrom)} → {formatPeso(preview.valueTo)}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Input
        label="Reason (optional)"
        value={fields.reason}
        onChangeText={dialog.setReason}
        placeholder="e.g. Supplier price list"
        maxLength={REASON_MAX}
        error={dialog.errors.reason}
        editable={editable}
        ref={reasonRef}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (editable) dialog.submit();
        }}
        testID={`${testID}-reason`}
      />
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
  preview: {
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  previewLabel: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  previewRate: {
    ...typography.price,
    color: colors.primary,
  },
  previewRateBad: {
    color: colors.dangerText,
  },
  previewMuted: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
