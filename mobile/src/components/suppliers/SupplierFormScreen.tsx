import { useRef } from 'react';
import type { TextInput } from 'react-native';

import { PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection } from '@/components/shared/FormSection';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { ROUTES } from '@/constants/routes';
import { SUPPLIER_LIMITS, useSupplierForm } from '@/hooks/suppliers/useSupplierForm';
import { useCanManageSuppliers } from '@/hooks/suppliers/useSuppliers';
import { useIsOnline } from '@/hooks/useIsOnline';
import type { Supplier } from '@/services/types';
import { goBackOr } from '@/utils/navigation';

function backToList() {
  goBackOr(ROUTES.suppliers);
}

/**
 * Create / edit a supplier (`supplier.manage`; read-only otherwise): name,
 * contact person and number, email, address, active. Delete asks first; a
 * supplier already on a PR or PO returns 409 (`Deactivate it instead.`), shown
 * in the banner. One centred column (max 480). Needs a connection.
 */
export function SupplierFormScreen({ supplier }: { supplier?: Supplier }) {
  const form = useSupplierForm({ initial: supplier, onSaved: backToList, onDeleted: backToList });
  // Keyboard "Next" moves through the fields.
  const supplierContactPersonRef = useRef<TextInput>(null);
  const supplierContactNumberRef = useRef<TextInput>(null);
  const supplierEmailRef = useRef<TextInput>(null);
  const supplierAddressRef = useRef<TextInput>(null);
  const canManage = useCanManageSuppliers();
  const online = useIsOnline();
  const { values, setField, fieldErrors, busy } = form;
  const editable = canManage && online && !busy;
  const name = form.saved?.name ?? '';

  return (
    <FormLayout
      title={form.isEdit ? (canManage ? 'Edit supplier' : 'Supplier') : 'New supplier'}
      subtitle={form.isEdit ? name : null}
      onBack={backToList}
      banner={form.bannerError}
      testID="supplier-form-screen"
      main={
        <>
          {online ? null : <Banner variant="warning" message={PURCHASING_OFFLINE_MESSAGE} testID="supplier-form-offline" />}
          {!canManage ? <Banner variant="info" message="View only: you don't have permission to edit suppliers." testID="supplier-readonly" /> : null}
          <FormSection title="Supplier">
            <Input
              label="Name"
              value={values.name}
              onChangeText={(text) => setField('name', text)}
              error={fieldErrors.name}
              placeholder="e.g. Golden Mills Trading"
              maxLength={SUPPLIER_LIMITS.name}
              editable={editable}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => supplierContactPersonRef.current?.focus()}
              testID="supplier-name"
            />
            <Input
              label="Contact person (optional)"
              value={values.contactPerson}
              onChangeText={(text) => setField('contactPerson', text)}
              error={fieldErrors.contact_person}
              placeholder="e.g. Ana Reyes"
              autoCapitalize="words"
              leftIcon="person-outline"
              maxLength={SUPPLIER_LIMITS.contactPerson}
              editable={editable}
              ref={supplierContactPersonRef}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => supplierContactNumberRef.current?.focus()}
              testID="supplier-contact-person"
            />
            <Input
              label="Contact number (optional)"
              value={values.contactNumber}
              onChangeText={(text) => setField('contactNumber', text)}
              error={fieldErrors.contact_number}
              placeholder="e.g. 0917 123 4567"
              leftIcon="call-outline"
              keyboardType="phone-pad"
              maxLength={SUPPLIER_LIMITS.contactNumber}
              editable={editable}
              ref={supplierContactNumberRef}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => supplierEmailRef.current?.focus()}
              testID="supplier-contact-number"
            />
            <Input
              label="Email (optional)"
              value={values.email}
              onChangeText={(text) => setField('email', text)}
              error={fieldErrors.email}
              placeholder="orders@example.com"
              leftIcon="mail-outline"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={SUPPLIER_LIMITS.email}
              editable={editable}
              ref={supplierEmailRef}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => supplierAddressRef.current?.focus()}
              testID="supplier-email"
            />
            <Input
              label="Address (optional)"
              value={values.address}
              onChangeText={(text) => setField('address', text)}
              error={fieldErrors.address}
              placeholder="e.g. 12 Rizal St, Bacolod"
              multiline
              maxLength={SUPPLIER_LIMITS.address}
              editable={editable}
              ref={supplierAddressRef}
              testID="supplier-address"
            />
            <SwitchRow
              label="Active"
              description="Inactive suppliers can't be chosen on new requests."
              value={values.isActive}
              onValueChange={(value) => setField('isActive', value)}
              error={fieldErrors.is_active}
              disabled={!editable}
              testID="supplier-active"
            />
          </FormSection>
          {canManage ? (
            <Button
              title={form.isEdit ? 'Save changes' : 'Create supplier'}
              leftIcon="checkmark"
              size="lg"
              onPress={form.submit}
              loading={form.submitting}
              disabled={!editable}
              testID="supplier-save"
            />
          ) : null}
          {form.isEdit && canManage ? (
            <Button title="Delete supplier" leftIcon="trash-outline" variant="danger" onPress={form.deleteDialog.request} disabled={!editable} testID="supplier-delete" />
          ) : null}
        </>
      }
    >
      <ConfirmDialog
        visible={form.deleteDialog.visible}
        title="Delete supplier?"
        message={`“${name}” will be removed. A supplier already on a request or order can't be deleted: deactivate it instead.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        icon="trash-outline"
        busy={form.deleteDialog.busy}
        onConfirm={form.deleteDialog.confirm}
        onCancel={form.deleteDialog.cancel}
        testID="delete-supplier-dialog"
      />
    </FormLayout>
  );
}

