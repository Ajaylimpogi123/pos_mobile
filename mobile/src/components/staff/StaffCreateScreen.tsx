import { useRef } from 'react';
import { StyleSheet, Text, type TextInput } from 'react-native';

import { RolePickerField } from '@/components/staff/RolePickerField';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection } from '@/components/shared/FormSection';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { ROUTES } from '@/constants/routes';
import { colors, spacing, typography } from '@/constants/theme';
import { PASSWORD_POLICY_HINT, sanitizePinInput, STAFF_LIMITS } from '@/hooks/staff/staffRules';
import { useStaffCreateForm } from '@/hooks/staff/useStaffForms';
import { goBackOr } from '@/utils/navigation';

function backToList() {
  goBackOr(ROUTES.staff);
}

/**
 * New staff member (POST /api/v1/admin/users).
 * - "Account" card: name, email, password (show/hide + the policy as helper text).
 * - "Access" card: role (assignable roles only), Active, optional PIN.
 * - Phones / tablet portrait: one column (max 480). Tablet landscape: the
 *   two cards side by side, Create underneath.
 * Form state lives in `useStaffCreateForm()` here, above the layout switch,
 * so rotating keeps what was typed.
 */
export function StaffCreateScreen() {
  const form = useStaffCreateForm({ onSaved: backToList });
  // Keyboard "Next" moves through the fields.
  const staffEmailRef = useRef<TextInput>(null);
  const staffPasswordRef = useRef<TextInput>(null);
  const { values, setField, fieldErrors, busy } = form;

  return (
    <FormLayout
      title="New staff"
      onBack={backToList}
      banner={form.bannerError}
      testID="staff-create-screen"
      main={
        <FormSection title="Account">
          <Input
            label="Name"
            value={values.name}
            onChangeText={(text) => setField('name', text)}
            error={fieldErrors.name}
            placeholder="e.g. Carla Cashier"
            leftIcon="person-outline"
            autoCapitalize="words"
            maxLength={STAFF_LIMITS.name}
            editable={!busy}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => staffEmailRef.current?.focus()}
            testID="staff-name"
          />
          <Input
            label="Email"
            value={values.email}
            onChangeText={(text) => setField('email', text)}
            error={fieldErrors.email}
            placeholder="name@example.com"
            leftIcon="mail-outline"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            maxLength={STAFF_LIMITS.email}
            editable={!busy}
            ref={staffEmailRef}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => staffPasswordRef.current?.focus()}
            testID="staff-email"
          />
          <PasswordInput
            label="Password"
            value={values.password}
            onChangeText={(text) => setField('password', text)}
            error={fieldErrors.password}
            placeholder="New password"
            maxLength={STAFF_LIMITS.passwordMax}
            editable={!busy}
            ref={staffPasswordRef}
            returnKeyType="done"
            testID="staff-password"
          />
          <Text style={styles.help} testID="staff-password-policy">
            {PASSWORD_POLICY_HINT}
          </Text>
        </FormSection>
      }
      aside={
        <FormSection title="Access">
          <RolePickerField
            selectedId={values.roleId}
            onChange={(roleId) => setField('roleId', roleId)}
            error={fieldErrors.role_id}
            disabled={busy}
          />
          <SwitchRow
            label="Active"
            description="Inactive staff can't log in."
            value={values.isActive}
            onValueChange={(value) => setField('isActive', value)}
            error={fieldErrors.is_active}
            disabled={busy}
            testID="staff-active"
          />
          <Input
            label="PIN (optional)"
            value={values.pin}
            onChangeText={(text) => setField('pin', sanitizePinInput(text))}
            error={fieldErrors.pin}
            placeholder="4 to 6 digits"
            leftIcon="keypad-outline"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={STAFF_LIMITS.pinMax}
            editable={!busy}
            testID="staff-pin"
          />
          <Text style={styles.help}>For quick switching at the counter. Avoid easy PINs like 1111 or 1234.</Text>
        </FormSection>
      }
      asidePlacement="end"
      footer={
        <Button
          title="Create staff"
          leftIcon="person-add-outline"
          size="lg"
          onPress={form.submit}
          loading={form.submitting}
          disabled={busy}
          testID="staff-save"
        />
      }
    />
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
