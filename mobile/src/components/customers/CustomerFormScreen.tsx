import { useRef } from 'react';
import type { TextInput } from 'react-native';

import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection } from '@/components/shared/FormSection';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { ROUTES } from '@/constants/routes';
import { CUSTOMER_LIMITS, useCustomerForm } from '@/hooks/customers/useCustomerForm';
import type { Customer } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { goBackOr } from '@/utils/navigation';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

type CustomerFormScreenProps = {
  /** The customer to edit; omitted when creating. */
  customer?: Customer;
};

function backToList() {
  goBackOr(ROUTES.customers);
}

/**
 * Create / edit a customer: first and last name, contact (phone keypad),
 * email and notes, in one centred column (max 480) on every device.
 * - Save needs `sale.create`; without it the record is shown read-only.
 * - Delete needs `customer.manage` and asks for confirmation.
 * 422 → under each field; anything else → the banner.
 */
export function CustomerFormScreen({ customer }: CustomerFormScreenProps) {
  const form = useCustomerForm({ initial: customer, onSaved: backToList, onDeleted: backToList });
  // Keyboard "Next" moves through the fields.
  const customerLastNameRef = useRef<TextInput>(null);
  const customerContactRef = useRef<TextInput>(null);
  const customerEmailRef = useRef<TextInput>(null);
  const customerNotesRef = useRef<TextInput>(null);
  const canEdit = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));
  const canDelete = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.customerManage));
  const { values, setField, fieldErrors, busy } = form;
  const editable = canEdit && !busy;
  const name = form.saved?.full_name ?? '';

  return (
    <FormLayout
      title={form.isEdit ? (canEdit ? 'Edit customer' : 'Customer') : 'New customer'}
      subtitle={form.isEdit ? name : null}
      onBack={backToList}
      banner={form.bannerError}
      testID="customer-form-screen"
      main={
        <>
          {!canEdit ? (
            <Banner variant="info" message="View only: you don't have permission to edit customers." testID="customer-readonly" />
          ) : null}
          <FormSection title="Customer">
            <Input
              label="First name"
              value={values.firstName}
              onChangeText={(text) => setField('firstName', text)}
              error={fieldErrors.first_name}
              placeholder="e.g. Maria"
              autoCapitalize="words"
              maxLength={CUSTOMER_LIMITS.firstName}
              editable={editable}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => customerLastNameRef.current?.focus()}
              testID="customer-first-name"
            />
            <Input
              label="Last name (optional)"
              value={values.lastName}
              onChangeText={(text) => setField('lastName', text)}
              error={fieldErrors.last_name}
              placeholder="e.g. Santos"
              autoCapitalize="words"
              maxLength={CUSTOMER_LIMITS.lastName}
              editable={editable}
              ref={customerLastNameRef}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => customerContactRef.current?.focus()}
              testID="customer-last-name"
            />
            <Input
              label="Contact (optional)"
              value={values.contact}
              onChangeText={(text) => setField('contact', text)}
              error={fieldErrors.contact}
              placeholder="e.g. 0917 123 4567"
              leftIcon="call-outline"
              keyboardType="phone-pad"
              autoComplete="tel"
              maxLength={CUSTOMER_LIMITS.contact}
              editable={editable}
              ref={customerContactRef}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => customerEmailRef.current?.focus()}
              testID="customer-contact"
            />
            <Input
              label="Email (optional)"
              value={values.email}
              onChangeText={(text) => setField('email', text)}
              error={fieldErrors.email}
              placeholder="name@example.com"
              leftIcon="mail-outline"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              maxLength={CUSTOMER_LIMITS.email}
              editable={editable}
              ref={customerEmailRef}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => customerNotesRef.current?.focus()}
              testID="customer-email"
            />
            <Input
              label="Notes (optional)"
              value={values.notes}
              onChangeText={(text) => setField('notes', text)}
              error={fieldErrors.notes}
              placeholder="e.g. Prefers less rice"
              multiline
              maxLength={CUSTOMER_LIMITS.notes}
              editable={editable}
              ref={customerNotesRef}
              testID="customer-notes"
            />
          </FormSection>

          {canEdit ? (
            <Button
              title={form.isEdit ? 'Save changes' : 'Create customer'}
              leftIcon="checkmark"
              size="lg"
              onPress={form.submit}
              loading={form.submitting}
              disabled={busy}
              testID="customer-save"
            />
          ) : null}
          {form.isEdit && canDelete ? (
            <Button
              title="Delete customer"
              leftIcon="trash-outline"
              variant="danger"
              onPress={form.deleteDialog.request}
              disabled={busy}
              testID="customer-delete"
            />
          ) : null}
        </>
      }
    >
      <ConfirmDialog
        visible={form.deleteDialog.visible}
        title="Delete customer?"
        message={`“${name}” will be removed from the customer list. Past orders keep their records.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        icon="trash-outline"
        busy={form.deleteDialog.busy}
        onConfirm={form.deleteDialog.confirm}
        onCancel={form.deleteDialog.cancel}
        testID="delete-customer-dialog"
      />
    </FormLayout>
  );
}

