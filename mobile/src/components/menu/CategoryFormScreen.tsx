import { useRef } from 'react';
import { StyleSheet, Text, type TextInput } from 'react-native';

import { ImagePickerPanel } from '@/components/menu/ImagePickerPanel';
import { itemCountLabel } from '@/components/menu/CategoryCard';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection } from '@/components/shared/FormSection';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { ROUTES } from '@/constants/routes';
import { colors, spacing, typography } from '@/constants/theme';
import { CATEGORY_LIMITS, useCategoryForm } from '@/hooks/menu/useCategoryForm';
import type { Category } from '@/services/types';
import { goBackOr } from '@/utils/navigation';

type CategoryFormScreenProps = {
  /** The category to edit; omitted when creating. */
  category?: Category;
};

const LIST_ROUTE = ROUTES.menuCategories;

function backToList() {
  goBackOr(LIST_ROUTE);
}

/**
 * Create / edit a category. Deleting a category that still has products
 * returns 409; its message is shown in the banner.
 */
export function CategoryFormScreen({ category }: CategoryFormScreenProps) {
  const form = useCategoryForm({ initial: category, onSaved: backToList, onDeleted: backToList });
  // Keyboard "Next" moves through the fields.
  const categoryDescriptionRef = useRef<TextInput>(null);
  const { values, setField, fieldErrors, busy } = form;

  let saveLabel = form.isEdit ? 'Save changes' : 'Create category';
  if (form.stage === 'uploading') saveLabel = 'Uploading image…';

  const productCount = form.saved?.products_count ?? 0;

  return (
    <FormLayout
      title={form.isEdit ? 'Edit category' : 'New category'}
      subtitle={form.isEdit ? form.saved?.name : null}
      onBack={backToList}
      banner={form.bannerError}
      testID="category-form-screen"
      aside={<ImagePickerPanel image={form.image} placeholderIcon="grid-outline" title="Category photo" disabled={busy} />}
      main={
        <>
          <FormSection title="Details">
            <Input
              label="Name"
              value={values.name}
              onChangeText={(text) => setField('name', text)}
              error={fieldErrors.name}
              placeholder="e.g. Breakfast"
              maxLength={CATEGORY_LIMITS.name}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => categoryDescriptionRef.current?.focus()}
              testID="category-name"
            />
            <Input
              label="Description (optional)"
              value={values.description}
              onChangeText={(text) => setField('description', text)}
              error={fieldErrors.description}
              placeholder="e.g. Served until 11 AM"
              multiline
              maxLength={CATEGORY_LIMITS.description}
              editable={!busy}
              ref={categoryDescriptionRef}
              testID="category-description"
            />
            <Input
              label="Sort order"
              value={values.sortOrder}
              onChangeText={(text) => setField('sortOrder', text)}
              error={fieldErrors.sort_order}
              placeholder="0"
              keyboardType="number-pad"
              maxLength={5}
              editable={!busy}
              returnKeyType="done"
              testID="category-sort-order"
            />
            <Text style={styles.help}>Lower numbers show first on the menu.</Text>
            <SwitchRow
              label="Active"
              description="Inactive categories and their products are hidden from the POS."
              value={values.isActive}
              onValueChange={(value) => setField('isActive', value)}
              error={fieldErrors.is_active}
              disabled={busy}
              testID="category-active"
            />
            {form.isEdit ? <Text style={styles.help}>{itemCountLabel(productCount)} in this category.</Text> : null}
          </FormSection>

          <Button
            title={saveLabel}
            leftIcon="checkmark"
            size="lg"
            onPress={form.submit}
            loading={form.submitting}
            disabled={busy}
            accessibilityLabel={saveLabel}
            testID="category-save"
          />
          {form.isEdit ? (
            <Button
              title="Delete category"
              leftIcon="trash-outline"
              variant="danger"
              onPress={form.deleteDialog.request}
              disabled={busy}
              testID="category-delete"
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
        title="Delete category?"
        message={
          productCount > 0
            ? `“${form.saved?.name ?? values.name}” still has ${itemCountLabel(productCount)}. Move or delete them first, or the server will refuse.`
            : `“${form.saved?.name ?? values.name}” will be removed from the menu.`
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        icon="trash-outline"
        busy={form.deleteDialog.busy}
        onConfirm={form.deleteDialog.confirm}
        onCancel={form.deleteDialog.cancel}
        testID="delete-category-dialog"
      />
    </FormLayout>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.lg,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
