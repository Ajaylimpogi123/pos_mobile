import { useRef } from 'react';
import { StyleSheet, Text, type TextInput } from 'react-native';

import { RolePickerField } from '@/components/staff/RolePickerField';
import { StaffSecurityCard } from '@/components/staff/StaffSecurityCard';
import { StaffSecurityDialogs } from '@/components/staff/StaffSecurityDialogs';
import { FormFooter } from '@/components/shared/FormFooter';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection } from '@/components/shared/FormSection';
import { Chip } from '@/components/ui/Chip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { focusField } from '@/components/ui/ErrorSummary';
import { ROUTES } from '@/constants/routes';
import { colors, spacing, typography } from '@/constants/theme';
import { STAFF_LIMITS } from '@/hooks/staff/staffRules';
import { useStaffEditForm } from '@/hooks/staff/useStaffForms';
import { useStaffSecurity } from '@/hooks/staff/useStaffSecurity';
import type { StaffUpdateRequest, StaffUser } from '@/services/types';
import { updateSessionProfile } from '@/services/session';
import { formatLastLogin } from '@/utils/dates';
import { goBackOr } from '@/utils/navigation';
import { showToast } from '@/stores/toast';

type StaffEditScreenProps = {
  staff: StaffUser;
  /** The signed-in user's own record. */
  isSelf: boolean;
};

function backToList() {
  goBackOr(ROUTES.staff);
}

/**
 * Edit a staff member the caller may manage (`can_manage: true`).
 * - "Details" card: name, email, role (assignable roles only) and Active,
 *   saved with PATCH (changed fields only). On your own record the role and
 *   Active controls are disabled, with a hint.
 * - "Security" card: reset password, set / change / remove PIN, delete
 *   (hidden on your own record). Each has its own request and dialog.
 * - Tablet landscape: the two cards side by side (max 960); otherwise one
 *   column (max 480), Security below Details.
 * 422 → under the matching field; 409 (self-protection) and other errors →
 * the banner. Editing your own name or email updates the session, so home
 * shows the new name.
 */
export function StaffEditScreen({ staff, isSelf }: StaffEditScreenProps) {
  const form = useStaffEditForm({
    staff,
    isSelf,
    onSaved: (user: StaffUser, changes: StaffUpdateRequest) => {
      if (isSelf && (changes.name !== undefined || changes.email !== undefined)) {
        void updateSessionProfile({ name: user.name, email: user.email });
      }
      // MASTER §6: save success is a toast.
      showToast('Staff saved.');
      backToList();
    },
    onDeleted: backToList,
  });
  const user = form.saved ?? staff;
  // Keyboard "Next" moves through the fields.
  const staffNameRef = useRef<TextInput>(null);
  const staffEmailRef = useRef<TextInput>(null);
  const security = useStaffSecurity({
    staff: user,
    isSelf,
    mutations: form.mutations,
    onUserChanged: form.setSaved,
    onError: form.setBannerError,
  });
  const { values, setField, fieldErrors } = form;
  const working = form.busy || security.pinDialog.busy || security.removePinDialog.busy || security.passwordDialog.busy;

  return (
    <FormLayout
      title="Edit staff"
      subtitle={user.name}
      onBack={backToList}
      banner={form.bannerError}
      fieldErrors={fieldErrors}
      onSelectError={(field) => focusField(field, { name: staffNameRef, email: staffEmailRef })}
      footer={
          <FormFooter
            onCancel={backToList}
            cancelDisabled={form.submitting}
            saveTitle={"Save changes"}
            onSave={form.submit}
            saving={form.submitting}
            saveDisabled={working}
            saveTestID="staff-save"
          />
      }
      notice={security.notice}
      testID="staff-edit-screen"
      main={
        <>
          <FormSection title="Details">
            {isSelf ? <Chip label="This is you" variant="primary" icon="person-circle-outline" testID="staff-self-chip" /> : null}
            <Input
              label="Name"
              value={values.name}
              onChangeText={(text) => setField('name', text)}
              error={fieldErrors.name}
              leftIcon="person-outline"
              autoCapitalize="words"
              maxLength={STAFF_LIMITS.name}
              editable={!working}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => staffEmailRef.current?.focus()}
              ref={staffNameRef}
              testID="staff-name"
            />
            <Input
              label="Email"
              value={values.email}
              onChangeText={(text) => setField('email', text)}
              error={fieldErrors.email}
              leftIcon="mail-outline"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              maxLength={STAFF_LIMITS.email}
              editable={!working}
              ref={staffEmailRef}
              returnKeyType="done"
              testID="staff-email"
            />
            <RolePickerField
              selectedId={values.roleId}
              onChange={(roleId) => setField('roleId', roleId)}
              currentRole={user.role}
              error={fieldErrors.role_id}
              disabled={working || isSelf}
              hint={isSelf ? "You can't change your own role." : undefined}
            />
            <SwitchRow
              label="Active"
              description={isSelf ? "You can't deactivate your own account." : "Inactive staff can't log in."}
              value={values.isActive}
              onValueChange={(value) => setField('isActive', value)}
              error={fieldErrors.is_active}
              disabled={working || isSelf}
              testID="staff-active"
            />
            <Text style={styles.help} testID="staff-last-login">
              Last login: {formatLastLogin(user.last_login_at)}
            </Text>
          </FormSection>
        </>
      }
      aside={
        <StaffSecurityCard
          user={user}
          isSelf={isSelf}
          disabled={working}
          onResetPassword={security.passwordDialog.open}
          onSetPin={security.pinDialog.open}
          onRemovePin={security.removePinDialog.request}
          onDelete={form.deleteDialog.request}
        />
      }
      asidePlacement="end"
    >
      <StaffSecurityDialogs user={user} isSelf={isSelf} security={security} />
      <ConfirmDialog
        visible={form.deleteDialog.visible}
        title="Delete staff?"
        message={`“${user.name}” will be removed and signed out everywhere. Past sales keep their records.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        icon="trash-outline"
        busy={form.deleteDialog.busy}
        onConfirm={form.deleteDialog.confirm}
        onCancel={form.deleteDialog.cancel}
        testID="delete-staff-dialog"
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
