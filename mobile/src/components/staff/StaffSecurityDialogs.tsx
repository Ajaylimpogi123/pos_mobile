import { StyleSheet, Text } from 'react-native';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { colors, typography } from '@/constants/theme';
import { PASSWORD_POLICY_HINT, STAFF_LIMITS } from '@/hooks/staff/staffRules';
import type { StaffSecurityState } from '@/hooks/staff/useStaffSecurity';
import type { StaffUser } from '@/services/types';

type StaffSecurityDialogsProps = {
  user: StaffUser;
  isSelf: boolean;
  security: StaffSecurityState;
};

/** The reset-password, set/change-PIN and remove-PIN dialogs of the staff edit screen. */
export function StaffSecurityDialogs({ user, isSelf, security }: StaffSecurityDialogsProps) {
  const { passwordDialog, pinDialog, removePinDialog } = security;

  return (
    <>
      <ConfirmDialog
        visible={passwordDialog.visible}
        title={isSelf ? 'Change your password' : `Reset password for ${user.name}`}
        message={
          isSelf
            ? 'Your other devices will be signed out. This one stays signed in.'
            : `${user.name} will be signed out on every device and must log in with the new password.`
        }
        confirmLabel={isSelf ? 'Change password' : 'Reset password'}
        icon="key-outline"
        busy={passwordDialog.busy}
        error={passwordDialog.banner}
        onConfirm={passwordDialog.submit}
        onCancel={passwordDialog.cancel}
        testID="password-dialog"
      >
        <PasswordInput
          label="New password"
          value={passwordDialog.password}
          onChangeText={passwordDialog.setPassword}
          shown={passwordDialog.shown}
          onToggleShown={passwordDialog.toggleShown}
          error={passwordDialog.error}
          placeholder="New password"
          maxLength={STAFF_LIMITS.passwordMax}
          editable={!passwordDialog.busy}
          onSubmitEditing={passwordDialog.submit}
          returnKeyType="done"
          testID="password-dialog-input"
        />
        <Text style={styles.help}>{PASSWORD_POLICY_HINT}</Text>
      </ConfirmDialog>

      <ConfirmDialog
        visible={pinDialog.visible}
        title={pinDialog.mode === 'change' ? 'Change PIN' : 'Set PIN'}
        message={`${isSelf ? 'Your' : `${user.name}'s`} PIN for quick switching at the counter: 4 to 6 digits. Avoid easy PINs like 1111 or 1234.`}
        confirmLabel={pinDialog.mode === 'change' ? 'Change PIN' : 'Set PIN'}
        icon="keypad-outline"
        busy={pinDialog.busy}
        error={pinDialog.banner}
        onConfirm={pinDialog.submit}
        onCancel={pinDialog.cancel}
        testID="pin-dialog"
      >
        <Input
          label="New PIN"
          value={pinDialog.pin}
          onChangeText={pinDialog.setPin}
          error={pinDialog.error}
          placeholder="4 to 6 digits"
          leftIcon="keypad-outline"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={STAFF_LIMITS.pinMax}
          editable={!pinDialog.busy}
          onSubmitEditing={pinDialog.submit}
          returnKeyType="done"
          testID="pin-dialog-input"
        />
      </ConfirmDialog>

      <ConfirmDialog
        visible={removePinDialog.visible}
        title="Remove PIN?"
        message={`${isSelf ? 'You' : user.name} won't be able to use quick switching until a new PIN is set.`}
        confirmLabel="Remove PIN"
        confirmVariant="danger"
        icon="close-circle-outline"
        busy={removePinDialog.busy}
        onConfirm={removePinDialog.confirm}
        onCancel={removePinDialog.cancel}
        testID="remove-pin-dialog"
      />
    </>
  );
}

const styles = StyleSheet.create({
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
