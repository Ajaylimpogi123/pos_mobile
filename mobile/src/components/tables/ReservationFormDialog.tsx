import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DateField } from '@/components/shared/DateField';
import { TimeField } from '@/components/shared/TimeField';
import { groupByArea } from '@/components/tables/tableLabels';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { Input } from '@/components/ui/Input';
import { LoadingState } from '@/components/ui/LoadingState';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { colors, spacing, typography } from '@/constants/theme';
import { RESERVATION_LIMITS, type ReservationsState } from '@/hooks/tables/useReservations';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';

/**
 * **New reservation** / **Edit reservation** (Table Management §E.2–3 and
 * §F): table, guest name, phone, party size, date, time and notes. The table
 * picker marks tables already booked within two hours of the chosen time; a
 * party larger than the table's seats only warns. `422`s show under their
 * fields, other errors in the banner; the draft lives in `useReservations`.
 */
export function ReservationFormDialog({ state }: { state: ReservationsState }) {
  const { isSmallPhone } = useResponsive();
  const { draft, errors, submitting } = state;
  const groups = useMemo(() => groupByArea(state.tables), [state.tables]);

  let tablePicker;
  if (state.tablesLoading) tablePicker = <LoadingState message="Loading tables…" testID="reservation-form-tables-loading" />;
  else if (state.tablesError) {
    tablePicker = (
      <View style={styles.inline}>
        <Banner message={getErrorMessage(state.tablesError)} testID="reservation-form-tables-error" />
        <Button title="Retry" variant="secondary" leftIcon="refresh" onPress={state.retryTables} testID="reservation-form-tables-retry" />
      </View>
    );
  } else {
    tablePicker = groups.map((group) => (
      <View key={group.key} style={styles.group}>
        {groups.length > 1 ? <Text style={styles.area}>{group.title}</Text> : null}
        <View style={styles.chips}>
          {group.items.map((table) => {
            const clash = state.clashes.has(table.id);
            return (
              <ChoiceChip
                key={table.id}
                label={clash ? `${table.name} · booked` : `${table.name} · ${table.seats}`}
                icon={clash ? 'alert-circle-outline' : undefined}
                selected={draft?.tableId === table.id}
                onPress={() => state.change({ tableId: table.id })}
                disabled={submitting}
                size="compact"
                testID={`reservation-form-table-${table.id}`}
              />
            );
          })}
        </View>
      </View>
    ));
  }

  return (
    <DialogFrame visible={draft !== null} onRequestClose={state.close} busy={submitting} testID="reservation-form">
      <Text style={styles.title} accessibilityRole="header">
        {draft?.editing ? 'Edit reservation' : 'New reservation'}
      </Text>
      {state.banner ? <Banner message={state.banner} testID="reservation-form-banner" /> : null}
      {draft ? (
        <View style={styles.fields}>
          <View style={styles.field}>
            <Text style={styles.label}>Table</Text>
            <Text style={styles.help}>The number is the seats; “booked” means another reservation within 2 hours of this time.</Text>
            {tablePicker}
            {errors.table_id ? (
              <Text style={styles.error} testID="reservation-form-table-error">
                {errors.table_id}
              </Text>
            ) : null}
          </View>
          <Input
            label="Guest name"
            value={draft.guestName}
            onChangeText={(guestName) => state.change({ guestName })}
            error={errors.guest_name}
            maxLength={RESERVATION_LIMITS.guestNameMax}
            placeholder="e.g. Santos"
            autoCapitalize="words"
            editable={!submitting}
            testID="reservation-form-guest"
          />
          <Input
            label="Phone (optional)"
            value={draft.phone}
            onChangeText={(phone) => state.change({ phone })}
            error={errors.phone}
            maxLength={RESERVATION_LIMITS.phoneMax}
            placeholder="0917 123 4567"
            keyboardType="phone-pad"
            editable={!submitting}
            testID="reservation-form-phone"
          />
          <View style={[styles.row, isSmallPhone && styles.stack]}>
            <Text style={styles.label}>Party size</Text>
            <QtyStepper
              value={draft.partySize}
              onChange={(partySize) => state.change({ partySize })}
              min={RESERVATION_LIMITS.partyMin}
              max={RESERVATION_LIMITS.partyMax}
              accessibilityLabel="Party size"
              disabled={submitting}
              testID="reservation-form-party"
            />
          </View>
          {errors.party_size ? <Text style={styles.error}>{errors.party_size}</Text> : null}
          {state.seatsWarning ? <Banner message={state.seatsWarning} variant="warning" testID="reservation-form-seats-warning" /> : null}
          <DateField label="Date" value={draft.date} onChange={(date) => state.change({ date: date ?? state.today })} disabled={submitting} testID="reservation-form-date" />
          <TimeField label="Time" value={draft.time} onChange={(time) => state.change({ time })} error={errors.reserved_for} disabled={submitting} testID="reservation-form-time" />
          <Input
            label="Notes (optional)"
            value={draft.notes}
            onChangeText={(notes) => state.change({ notes })}
            error={errors.notes}
            maxLength={RESERVATION_LIMITS.notesMax}
            placeholder="e.g. Birthday, high chair"
            multiline
            editable={!submitting}
            testID="reservation-form-notes"
          />
        </View>
      ) : null}
      <View style={[styles.actions, isSmallPhone && styles.stackReverse]}>
        <Button title="Cancel" variant="secondary" onPress={state.close} disabled={submitting} style={styles.action} testID="reservation-form-cancel" />
        <Button
          title={draft?.editing ? 'Save changes' : 'Book table'}
          leftIcon="checkmark"
          onPress={state.submit}
          loading={submitting}
          disabled={submitting}
          style={styles.action}
          testID="reservation-form-save"
        />
      </View>
    </DialogFrame>
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
  field: {
    gap: spacing.xs,
  },
  inline: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  help: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  group: {
    gap: spacing.xs,
  },
  area: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  stack: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  stackReverse: {
    flexDirection: 'column-reverse',
  },
  action: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
