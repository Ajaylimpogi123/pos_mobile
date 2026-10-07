import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { colors, spacing, typography } from '@/constants/theme';
import { useRoles } from '@/hooks/staff/useStaff';
import { getErrorMessage } from '@/services/api';
import type { StaffUserRole } from '@/services/types';

type RolePickerFieldProps = {
  selectedId: number | null;
  onChange: (roleId: number) => void;
  /**
   * The record's current role (edit). If the caller can't assign it, it is
   * still shown, selected and disabled, so the field never looks empty.
   */
  currentRole?: StaffUserRole;
  error?: string | null;
  disabled?: boolean;
  /** Muted line under the chips, e.g. "You can't change your own role". */
  hint?: string;
};

/**
 * Role picker: one selectable chip per role the caller may **assign**
 * (`assignable: true` from GET /api/v1/admin/roles). Chips wrap onto new rows
 * on narrow screens; each is at least 44 high.
 */
export function RolePickerField({ selectedId, onChange, currentRole, error, disabled = false, hint }: RolePickerFieldProps) {
  const roles = useRoles();

  const options: { id: number; name: string; assignable: boolean }[] = roles.assignable.map((role) => ({
    id: role.id,
    name: role.name,
    assignable: true,
  }));
  if (currentRole && !options.some((option) => option.id === currentRole.id)) {
    options.unshift({ id: currentRole.id, name: currentRole.name, assignable: false });
  }

  let content;
  if (roles.isPending) {
    content = <ActivityIndicator color={colors.primaryBright} style={styles.spinner} testID="role-picker-loading" />;
  } else if (roles.isError && options.length === 0) {
    content = (
      <View style={styles.loadError} testID="role-picker-error-state">
        <Text style={styles.error}>{getErrorMessage(roles.error)}</Text>
        <Button title="Retry" leftIcon="refresh" variant="secondary" onPress={() => void roles.refetch()} testID="role-picker-retry" />
      </View>
    );
  } else if (options.length === 0) {
    content = <Text style={styles.hint}>There are no roles you can assign.</Text>;
  } else {
    content = (
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Role">
        {options.map((option) => (
          <ChoiceChip
            key={option.id}
            label={option.name}
            icon="shield-checkmark-outline"
            selected={option.id === selectedId}
            onPress={() => onChange(option.id)}
            disabled={disabled || !option.assignable}
            testID={`role-option-${option.id}`}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.container} testID="role-picker">
      <Text style={styles.label}>Role</Text>
      {content}
      {hint ? (
        <Text style={styles.hint} testID="role-picker-hint">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="role-picker-error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
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
  spinner: {
    alignSelf: 'flex-start',
  },
  loadError: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  hint: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
});
