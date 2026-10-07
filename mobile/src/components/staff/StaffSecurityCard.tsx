import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { colors, spacing, typography } from '@/constants/theme';
import type { StaffUser } from '@/services/types';

type StaffSecurityCardProps = {
  user: StaffUser;
  isSelf: boolean;
  /** A save / delete / PIN request is in flight: every action waits. */
  disabled: boolean;
  onResetPassword: () => void;
  onSetPin: () => void;
  onRemovePin: () => void;
  onDelete: () => void;
};

/**
 * The staff edit screen's separate actions (not part of the PATCH form):
 * reset password, set / change / remove PIN, and delete. Delete is hidden on
 * your own record (the server would answer 409 anyway).
 */
export function StaffSecurityCard({
  user,
  isSelf,
  disabled,
  onResetPassword,
  onSetPin,
  onRemovePin,
  onDelete,
}: StaffSecurityCardProps) {
  return (
    <Card style={styles.card} testID="staff-security-card">
      <Text style={styles.title} accessibilityRole="header">
        Security
      </Text>

      <View style={styles.group}>
        <Text style={styles.groupTitle}>Password</Text>
        <Text style={styles.help}>
          {isSelf
            ? 'Changing your password signs out your other devices. This one stays signed in.'
            : 'Resetting signs this person out on every device.'}
        </Text>
        <Button
          title={isSelf ? 'Change password' : 'Reset password'}
          leftIcon="key-outline"
          variant="secondary"
          onPress={onResetPassword}
          disabled={disabled}
          testID="staff-reset-password"
        />
      </View>

      <View style={styles.group}>
        <View style={styles.groupHeader}>
          <Text style={styles.groupTitle}>PIN</Text>
          <Chip
            label={user.has_pin ? 'PIN set' : 'No PIN'}
            variant={user.has_pin ? 'success' : 'warning'}
            icon="keypad-outline"
            testID="staff-pin-status"
          />
        </View>
        <Text style={styles.help}>A 4–6 digit PIN for quick switching at the counter.</Text>
        <Button
          title={user.has_pin ? 'Change PIN' : 'Set PIN'}
          leftIcon="keypad-outline"
          variant="secondary"
          onPress={onSetPin}
          disabled={disabled}
          testID="staff-set-pin"
        />
        {user.has_pin ? (
          <Button
            title="Remove PIN"
            leftIcon="close-circle-outline"
            variant="ghost"
            onPress={onRemovePin}
            disabled={disabled}
            testID="staff-remove-pin"
          />
        ) : null}
      </View>

      <View style={styles.group}>
        <Text style={styles.groupTitle}>Delete</Text>
        {isSelf ? (
          <Text style={styles.help} testID="staff-delete-self-hint">
            You can&apos;t delete your own account.
          </Text>
        ) : (
          <>
            <Text style={styles.help}>Removes the account and signs it out everywhere. Past sales keep their records.</Text>
            <Button
              title="Delete staff"
              leftIcon="trash-outline"
              variant="danger"
              onPress={onDelete}
              disabled={disabled}
              testID="staff-delete"
            />
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xl,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  group: {
    gap: spacing.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  groupTitle: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
