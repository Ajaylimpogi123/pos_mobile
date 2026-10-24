import { StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { Input } from '@/components/ui/Input';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { colors, spacing, typography } from '@/constants/theme';
import { TABLE_LIMITS, type AdminTablesState } from '@/hooks/tables/useAdminTables';
import { useResponsive } from '@/hooks/useResponsive';

/**
 * Create or edit a table (Dine-in Tables & Tabs §B): name, area, seats, sort
 * order and Active; **Delete** (with a confirmation) on an existing table.
 * The draft lives in `useAdminTables`, above every layout switch.
 */
export function TableFormDialog({ screen }: { screen: AdminTablesState }) {
  const { isSmallPhone } = useResponsive();
  const { draft, errors, submitting } = screen;
  const editing = draft !== null && draft.id !== null;

  return (
    <>
      <DialogFrame visible={draft !== null && !screen.confirmDelete} onRequestClose={screen.close} busy={submitting} testID="table-form">
        <Text style={styles.title} accessibilityRole="header">
          {editing ? 'Edit table' : 'New table'}
        </Text>
        {screen.banner ? <Banner message={screen.banner} testID="table-form-banner" /> : null}
        {draft ? (
          <View style={styles.fields}>
            <Input
              label="Name"
              value={draft.name}
              onChangeText={(name) => screen.change({ name })}
              error={errors.name}
              maxLength={TABLE_LIMITS.nameMax}
              placeholder="e.g. 5 or P1"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!submitting}
              testID="table-form-name"
            />
            <Input
              label="Area (optional)"
              value={draft.area}
              onChangeText={(area) => screen.change({ area })}
              error={errors.area}
              maxLength={TABLE_LIMITS.areaMax}
              placeholder="e.g. Patio"
              editable={!submitting}
              testID="table-form-area"
            />
            <View style={[styles.row, isSmallPhone && styles.stack]}>
              <View style={styles.cell}>
                <Input
                  label="Seats"
                  value={draft.seats}
                  onChangeText={(seats) => screen.change({ seats })}
                  error={errors.seats}
                  keyboardType="number-pad"
                  maxLength={2}
                  editable={!submitting}
                  testID="table-form-seats"
                />
              </View>
              <View style={styles.cell}>
                <Input
                  label="Sort order"
                  value={draft.sortOrder}
                  onChangeText={(sortOrder) => screen.change({ sortOrder })}
                  error={errors.sortOrder}
                  keyboardType="number-pad"
                  maxLength={4}
                  editable={!submitting}
                  testID="table-form-sort"
                />
              </View>
            </View>
            <SwitchRow
              label="Active"
              description="Inactive tables don't show on Sell."
              value={draft.isActive}
              onValueChange={(isActive) => screen.change({ isActive })}
              error={errors.isActive}
              disabled={submitting}
              testID="table-form-active"
            />
          </View>
        ) : null}
        <View style={[styles.actions, isSmallPhone && styles.stack]}>
          {editing ? (
            <Button
              title="Delete"
              leftIcon="trash-outline"
              variant="danger"
              onPress={screen.requestDelete}
              disabled={submitting}
              style={styles.action}
              testID="table-form-delete"
            />
          ) : null}
          <Button title="Cancel" variant="secondary" onPress={screen.close} disabled={submitting} style={styles.action} testID="table-form-cancel" />
          <Button
            title="Save"
            leftIcon="checkmark"
            onPress={screen.save}
            loading={submitting}
            disabled={submitting}
            style={styles.action}
            testID="table-form-save"
          />
        </View>
      </DialogFrame>
      <ConfirmDialog
        visible={draft !== null && screen.confirmDelete}
        title="Delete this table?"
        message={draft ? `Table ${draft.name.trim()} is removed from Sell. Orders already paid keep its name.` : undefined}
        confirmLabel="Delete table"
        confirmVariant="danger"
        icon="trash-outline"
        busy={submitting}
        onConfirm={screen.confirmDeleteTable}
        onCancel={screen.cancelDelete}
        testID="table-delete-dialog"
      />
    </>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.text,
  },
  fields: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stack: {
    flexDirection: 'column',
  },
  cell: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  action: {
    flexGrow: 1,
  },
});
