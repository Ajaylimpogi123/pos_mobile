import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { UnitsEditor } from '@/components/ingredients/UnitsEditor';
import { IngredientCostDialog } from '@/components/inventory/IngredientStockDialogs';
import { ImagePickerPanel } from '@/components/menu/ImagePickerPanel';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection } from '@/components/shared/FormSection';
import { DetailRow } from '@/components/shared/InfoCard';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { ROUTES } from '@/constants/routes';
import { colors, layout, radius, spacing, typography } from '@/constants/theme';
import { costRateTexts, useIngredientCostDialog, type IngredientCostDialogState } from '@/hooks/ingredients/useIngredientCost';
import { INGREDIENTS_OFFLINE_MESSAGE } from '@/hooks/ingredients/useIngredients';
import { BASE_UNIT_LOCKED_MESSAGE, INGREDIENT_LIMITS, useIngredientForm } from '@/hooks/ingredients/useIngredientForm';
import { useIsOnline } from '@/hooks/useIsOnline';
import type { Ingredient } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatPeso } from '@/utils/money';
import { goBackOr } from '@/utils/navigation';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { BASE_UNITS } from '@/utils/units';

function backToList() {
  goBackOr(ROUTES.ingredients);
}

/** §D1 on the edit screen: this branch's average cost and stock value, with **Set cost**. */
function CostCard({ ingredient, dialog, disabled }: { ingredient: Ingredient; dialog: IngredientCostDialogState; disabled: boolean }) {
  const rate = costRateTexts(ingredient.avg_cost, ingredient.base_unit);
  return (
    <FormSection
      title="Cost"
      description="For this branch. Uses the saved units; receipts keep re-weighting the cost."
      testID="ingredient-cost-card"
    >
      <View style={styles.costRow}>
        <View style={styles.metric}>
          <DetailRow label="Average cost" value={rate.perLarger ? `${rate.perLarger} · ${rate.perBase}` : rate.perBase} testID="ingredient-cost-average" />
        </View>
        <View style={styles.metric}>
          <DetailRow label="Stock value" value={formatPeso(ingredient.stock_value_cents)} testID="ingredient-cost-value" />
        </View>
      </View>
      <Button title="Set cost" leftIcon="pricetag-outline" variant="tonal" onPress={dialog.open} disabled={disabled} testID="ingredient-set-cost" />
    </FormSection>
  );
}

/**
 * Create / edit an ingredient (`product.manage`): name, base unit (`g`, `mL`
 * or `pc`; locked once the ingredient is in use), active, the photo, and the
 * units editor. Save: POST / PATCH, then the image upload. 422s go under
 * their fields (each unit row too); a 409 (base unit in use, a unit on an
 * open PO, delete while in use) shows in the banner. Needs a connection.
 */
export function IngredientFormScreen({ ingredient }: { ingredient?: Ingredient }) {
  const form = useIngredientForm({ initial: ingredient, onSaved: backToList, onDeleted: backToList });
  const online = useIsOnline();
  // §D1: Set cost needs `inventory.adjust`, on a saved ingredient (its saved units are the valid ones).
  const canSetCost = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.inventoryAdjust));
  const [costNotice, setCostNotice] = useState<string | null>(null);
  const costDialog = useIngredientCostDialog(form.saved, (notice, updated) => {
    form.replaceSaved(updated);
    setCostNotice(notice);
  });
  const { values, setField, fieldErrors, busy } = form;
  const blocked = busy || !online;

  let saveLabel = form.isEdit ? 'Save changes' : 'Create ingredient';
  if (form.stage === 'uploading') saveLabel = 'Uploading image…';

  return (
    <FormLayout
      title={form.isEdit ? 'Edit ingredient' : 'New ingredient'}
      subtitle={form.isEdit ? form.saved?.name : null}
      onBack={backToList}
      banner={form.bannerError}
      testID="ingredient-form-screen"
      aside={<ImagePickerPanel image={form.image} placeholderIcon="nutrition-outline" title="Ingredient photo" disabled={blocked} />}
      main={
        <>
          {online ? null : <Banner variant="warning" message={INGREDIENTS_OFFLINE_MESSAGE} testID="ingredient-form-offline" />}
          {costNotice ? <Banner variant="success" message={costNotice} testID="ingredient-cost-notice" /> : null}
          <FormSection title="Details">
            <Input
              label="Name"
              value={values.name}
              onChangeText={(text) => setField('name', text)}
              error={fieldErrors.name}
              placeholder="e.g. Flour"
              maxLength={INGREDIENT_LIMITS.name}
              editable={!blocked}
              returnKeyType="done"
              testID="ingredient-name"
            />
            <View style={styles.baseUnit}>
              <Text style={styles.label}>Base unit</Text>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Base unit">
                {BASE_UNITS.map((option) => (
                  <ChoiceChip
                    key={option.value}
                    label={option.label}
                    selected={form.baseUnit === option.value}
                    onPress={() => form.setBaseUnit(option.value)}
                    disabled={blocked || form.baseUnitLocked}
                    testID={`ingredient-base-${option.value}`}
                  />
                ))}
              </View>
              {fieldErrors.base_unit ? (
                <Text style={styles.error} testID="ingredient-base-error">
                  {fieldErrors.base_unit}
                </Text>
              ) : null}
              <Text style={styles.help} testID="ingredient-base-help">
                {form.baseUnitLocked
                  ? BASE_UNIT_LOCKED_MESSAGE
                  : `${BASE_UNITS.find((option) => option.value === form.baseUnit)?.hint ?? ''}. Stock and costs are kept in this unit.`}
              </Text>
            </View>
            <SwitchRow
              label="Active"
              description="Inactive ingredients can't be requested or bought."
              value={values.isActive}
              onValueChange={(value) => setField('isActive', value)}
              error={fieldErrors.is_active}
              disabled={blocked}
              testID="ingredient-active"
            />
          </FormSection>

          {form.saved && canSetCost ? <CostCard ingredient={form.saved} dialog={costDialog} disabled={blocked} /> : null}

          <UnitsEditor editor={form.unitsEditor} baseUnit={form.baseUnit} disabled={blocked} error={fieldErrors.units} />

          <Button
            title={saveLabel}
            leftIcon="checkmark"
            size="lg"
            onPress={form.submit}
            loading={form.submitting}
            disabled={blocked}
            accessibilityLabel={saveLabel}
            testID="ingredient-save"
          />
          {form.isEdit ? (
            <Button
              title="Delete ingredient"
              leftIcon="trash-outline"
              variant="danger"
              onPress={form.deleteDialog.request}
              disabled={blocked}
              testID="ingredient-delete"
            />
          ) : null}
        </>
      }
    >
      {form.saved && canSetCost ? <IngredientCostDialog dialog={costDialog} item={form.saved} /> : null}
      <ConfirmDialog
        visible={form.removeImageDialog.visible}
        title="Remove image?"
        message="The photo is deleted from the server. You can add a new one any time."
        confirmLabel="Remove"
        confirmVariant="danger"
        icon="trash-outline"
        busy={form.removeImageDialog.busy}
        onConfirm={form.removeImageDialog.confirm}
        onCancel={form.removeImageDialog.cancel}
        testID="remove-image-dialog"
      />
      <ConfirmDialog
        visible={form.deleteDialog.visible}
        title="Delete ingredient?"
        message={`“${form.saved?.name ?? values.name}” will be removed. An ingredient on a recipe or an open purchase order can't be deleted: deactivate it instead.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        icon="trash-outline"
        busy={form.deleteDialog.busy}
        onConfirm={form.deleteDialog.confirm}
        onCancel={form.deleteDialog.cancel}
        testID="delete-ingredient-dialog"
      />
    </FormLayout>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.lg,
  },
  baseUnit: {
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
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  costRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: spacing.md,
  },
  metric: {
    flexGrow: 1,
    flexBasis: layout.sectionTitleMinWidth,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
});
