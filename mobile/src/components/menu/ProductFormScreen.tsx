import { useRef } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View, type TextInput } from 'react-native';

import { CategoryPickerField } from '@/components/menu/CategoryPickerField';
import { ImagePickerPanel } from '@/components/menu/ImagePickerPanel';
import { RecipeSection } from '@/components/menu/RecipeSection';
import { StockCard } from '@/components/menu/StockCard';
import { FormFooter } from '@/components/shared/FormFooter';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection } from '@/components/shared/FormSection';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { focusField } from '@/components/ui/ErrorSummary';
import { editProductRoute, ROUTES } from '@/constants/routes';
import { colors, spacing, typography } from '@/constants/theme';
import { PRODUCT_LIMITS, useProductForm } from '@/hooks/menu/useProductForm';
import { useRecipeBuilder } from '@/hooks/menu/useRecipeBuilder';
import type { AdminProduct, StockMode } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { centsToInputText } from '@pos/core/money';
import { goBackOr } from '@/utils/navigation';
import { formatCount } from '@pos/core/numbers';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { showToast } from '@/stores/toast';
import { STOCK_MODES, stockModeOf } from '@pos/core/recipe';

type ProductFormScreenProps = {
  /** The product to edit; omitted when creating. */
  product?: AdminProduct;
};

const LIST_ROUTE = ROUTES.menuProducts;

function backToList() {
  goBackOr(LIST_ROUTE);
}

const STOCK_MODE_OPTIONS = STOCK_MODES.map((mode) => ({
  value: mode.value,
  label: mode.label,
  testID: `product-stock-mode-${mode.value}`,
}));

/**
 * Create / edit a product. Form state lives in `useProductForm()` here,
 * above the layout switch in `FormLayout`, so rotation keeps the input.
 * A saved `track_stock` product also shows its stock on hand, with "Adjust
 * stock" for users with `inventory.adjust` (read from the `product` prop, which
 * follows the cache, so an adjustment shows at once).
 *
 * §J: the stock mode selector (`Own stock` / `Recipe` / `Not tracked`). The
 * server's 409 for leaving own stock with stock on hand shows in the banner
 * and under the selector. A saved `recipe` product gets the recipe builder,
 * beside the product fields on tablet landscape and below them otherwise; its
 * state lives in `useRecipeBuilder()` here, above the layout switch.
 */
export function ProductFormScreen({ product }: ProductFormScreenProps) {
  const form = useProductForm({ initial: product, onSaved: handleSaved, onDeleted: backToList });
  // Keyboard "Next" moves through the fields.
  const productNameRef = useRef<TextInput>(null);
  const productSkuRef = useRef<TextInput>(null);
  const productCostRef = useRef<TextInput>(null);
  const productSortOrderRef = useRef<TextInput>(null);
  const { values, setField, fieldErrors, busy } = form;
  const canAdjustStock = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.inventoryAdjust));
  const recipeProduct = form.saved && stockModeOf(form.saved) === 'recipe' ? form.saved : null;
  const recipe = useRecipeBuilder({
    product: recipeProduct,
    onCostApplied: (updated) => {
      form.replaceSaved(updated);
      setField('cost', centsToInputText(updated.cost_cents));
    },
  });

  /**
   * After Save: a product that just became `recipe` stays open (a new one
   * reopens as its edit screen) so its recipe can be built; otherwise back.
   */
  function handleSaved(saved: AdminProduct) {
    // MASTER §6: save success is a toast.
    showToast('Product saved.');
    const nowRecipe = stockModeOf(saved) === 'recipe';
    if (nowRecipe && !product) router.replace(editProductRoute(saved.id));
    else if (!nowRecipe || stockModeOf(product ?? saved) === 'recipe') backToList();
  }

  const savedMode: StockMode | null = product ? stockModeOf(product) : null;
  const stockOnHand = savedMode === 'own' ? (product?.stock_qty ?? 0) : 0;
  const modeInfo = STOCK_MODES.find((mode) => mode.value === values.stockMode);

  const imagePanel = (
    <ImagePickerPanel image={form.image} placeholderIcon="fast-food-outline" title="Product photo" disabled={busy} />
  );
  const recipeSection = recipeProduct ? <RecipeSection builder={recipe} productId={recipeProduct.id} /> : null;

  let saveLabel = form.isEdit ? 'Save changes' : 'Create product';
  if (form.stage === 'uploading') saveLabel = 'Uploading image…';

  return (
    <FormLayout
      title={form.isEdit ? 'Edit product' : 'New product'}
      subtitle={form.isEdit ? form.saved?.name : null}
      onBack={backToList}
      banner={form.bannerError}
      fieldErrors={fieldErrors}
      onSelectError={(field) => focusField(field, { name: productNameRef, sku: productSkuRef, cost_cents: productCostRef, sort_order: productSortOrderRef })}
      footer={
          <FormFooter
            onCancel={backToList}
            cancelDisabled={form.submitting}
            saveTitle={saveLabel}
            onSave={form.submit}
            saving={form.submitting}
            saveDisabled={busy}
            saveTestID="product-save"
          />
      }
      testID="product-form-screen"
      // A recipe product: the recipe sits beside (tablet landscape) or below the product fields.
      asidePlacement={recipeSection ? 'end' : 'start'}
      aside={
        recipeSection ?? (
          <View style={styles.aside}>
            {imagePanel}
            {product?.track_stock ? <StockCard product={product} canAdjust={canAdjustStock} /> : null}
          </View>
        )
      }
      main={
        <>
          {recipeSection ? imagePanel : null}
          <FormSection title="Details">
            <Input
              label="Name"
              value={values.name}
              onChangeText={(text) => setField('name', text)}
              error={fieldErrors.name}
              placeholder="e.g. Egg with Rice"
              maxLength={PRODUCT_LIMITS.name}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => productSkuRef.current?.focus()}
              ref={productNameRef}
              testID="product-name"
            />
            <CategoryPickerField
              categoryId={values.categoryId}
              categoryName={values.categoryName}
              onChange={(category) => {
                setField('categoryId', category.id);
                setField('categoryName', category.name);
              }}
              error={fieldErrors.category_id}
              disabled={busy}
            />
            <Input
              label="SKU (optional)"
              value={values.sku}
              onChangeText={(text) => setField('sku', text)}
              error={fieldErrors.sku}
              placeholder="e.g. BRK-001"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={PRODUCT_LIMITS.sku}
              editable={!busy}
              ref={productSkuRef}
              returnKeyType="done"
              testID="product-sku"
            />
            <Input
              label="Description (optional)"
              value={values.description}
              onChangeText={(text) => setField('description', text)}
              error={fieldErrors.description}
              placeholder="e.g. Two fried eggs, garlic rice"
              multiline
              maxLength={PRODUCT_LIMITS.description}
              editable={!busy}
              testID="product-description"
            />
          </FormSection>

          <FormSection title="Pricing">
            <Input
              label="Price (VAT-inclusive)"
              prefix="₱"
              value={values.price}
              onChangeText={(text) => setField('price', text)}
              error={fieldErrors.price_cents}
              placeholder="0.00"
              keyboardType="decimal-pad"
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => productCostRef.current?.focus()}
              testID="product-price"
            />
            <Input
              label="Cost (optional)"
              prefix="₱"
              value={values.cost}
              onChangeText={(text) => setField('cost', text)}
              error={fieldErrors.cost_cents}
              placeholder="0.00"
              keyboardType="decimal-pad"
              editable={!busy}
              ref={productCostRef}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => productSortOrderRef.current?.focus()}
              testID="product-cost"
            />
            <Text style={styles.help}>
              {recipeProduct
                ? 'Cost is only shown in the admin area. “Use as product cost” in the recipe fills it in.'
                : 'Cost is only shown in the admin area, never to cashiers.'}
            </Text>
          </FormSection>

          <FormSection title="Options">
            <SwitchRow
              label="Available"
              description="Unavailable items show greyed out on the POS and can't be sold."
              value={values.isAvailable}
              onValueChange={(value) => setField('isAvailable', value)}
              error={fieldErrors.is_available}
              disabled={busy}
              testID="product-available"
            />
            <SwitchRow
              label="VAT-able"
              description="Turn off for VAT-exempt items."
              value={values.isVatable}
              onValueChange={(value) => setField('isVatable', value)}
              error={fieldErrors.is_vatable}
              disabled={busy}
              testID="product-vatable"
            />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Stock</Text>
              <SegmentedControl<StockMode>
                options={STOCK_MODE_OPTIONS}
                value={values.stockMode}
                onChange={(mode) => setField('stockMode', mode)}
                disabled={busy}
                accessibilityLabel="Stock mode"
                testID="product-stock-mode"
              />
              {modeInfo ? <Text style={styles.help}>{modeInfo.description}</Text> : null}
              {fieldErrors.stock_mode ? (
                <Text style={styles.error} accessibilityLiveRegion="polite" testID="product-stock-mode-error">
                  {fieldErrors.stock_mode}
                </Text>
              ) : null}
              {values.stockMode !== 'own' && stockOnHand > 0 && !fieldErrors.stock_mode ? (
                <Text style={styles.warning} testID="product-stock-mode-warning">
                  {formatCount(stockOnHand)} still in stock. Use up or write off the stock before switching.
                </Text>
              ) : null}
              {values.stockMode === 'recipe' && !recipeProduct ? (
                <Text style={styles.help} testID="product-recipe-hint">
                  Save the product to build its recipe.
                </Text>
              ) : null}
            </View>
            <Input
              label="Sort order"
              value={values.sortOrder}
              onChangeText={(text) => setField('sortOrder', text)}
              error={fieldErrors.sort_order}
              placeholder="0"
              keyboardType="number-pad"
              maxLength={5}
              editable={!busy}
              ref={productSortOrderRef}
              returnKeyType="done"
              testID="product-sort-order"
            />
            <Text style={styles.help}>Lower numbers show first on the menu.</Text>
          </FormSection>

          {form.isEdit ? (
            <Button
              title="Delete product"
              leftIcon="trash-outline"
              variant="danger"
              onPress={form.deleteDialog.request}
              disabled={busy}
              testID="product-delete"
            />
          ) : null}
        </>
      }
    >
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
        title="Delete product?"
        message={`“${form.saved?.name ?? values.name}” will be removed from the menu. Past orders keep their own copy.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        icon="trash-outline"
        busy={form.deleteDialog.busy}
        onConfirm={form.deleteDialog.confirm}
        onCancel={form.deleteDialog.cancel}
        testID="delete-product-dialog"
      />
    </FormLayout>
  );
}

const styles = StyleSheet.create({
  aside: {
    gap: spacing.lg,
  },
  section: {
    gap: spacing.lg,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.text,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  warning: {
    ...typography.bodySm,
    color: colors.warningText,
  },
});
