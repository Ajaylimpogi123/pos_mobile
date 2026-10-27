import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { reservedForLabel, tableLabel } from '@/components/tables/tableLabels';
import { Banner } from '@/components/ui/Banner';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { IconBadge } from '@/components/ui/IconBadge';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/constants/theme';
import { CANCEL_REASON_MAX, targetOfTable, type ReservationActionsState } from '@/hooks/tables/useReservationActions';
import { useNow } from '@/hooks/useNow';
import { useResponsive } from '@/hooks/useResponsive';
import type { TableView } from '@/services/types';

/** The No-show button's "from 7:00 PM" check is refreshed this often. */
const CLOCK_MS = 15_000;

/**
 * The **Cancel** (optional reason) and **No-show** confirmations, and the
 * `409` dialog that reloads (Table Management §F "Errors").
 */
export function ReservationActionDialogs({ actions, time }: { actions: ReservationActionsState; time: (iso: string) => string }) {
  const { pending, busy } = actions;
  const target = pending?.target ?? null;
  const summary = target ? `${target.guestName} · ${tableLabel(target.tableName)} · ${time(target.reservedFor)}` : undefined;

  return (
    <>
      <ConfirmDialog
        visible={pending?.kind === 'cancel'}
        title="Cancel this reservation?"
        message={summary}
        confirmLabel="Cancel reservation"
        cancelLabel="Keep it"
        confirmVariant="danger"
        icon="close-circle-outline"
        busy={busy}
        error={pending?.error}
        onConfirm={actions.confirm}
        onCancel={actions.dismiss}
        testID="reservation-cancel-dialog"
      >
        <Input
          label="Reason (optional)"
          value={pending?.reason ?? ''}
          onChangeText={actions.setReason}
          maxLength={CANCEL_REASON_MAX}
          placeholder="e.g. Guest called to cancel"
          editable={!busy}
          testID="reservation-cancel-reason"
        />
      </ConfirmDialog>

      <ConfirmDialog
        visible={pending?.kind === 'no_show'}
        title="Mark as no-show?"
        message={summary ? `${summary}. The table is no longer held.` : undefined}
        confirmLabel="Mark no-show"
        cancelLabel="Back"
        confirmVariant="danger"
        icon="person-remove-outline"
        busy={busy}
        error={pending?.error}
        onConfirm={actions.confirm}
        onCancel={actions.dismiss}
        testID="reservation-no-show-dialog"
      />

      <DialogFrame visible={actions.conflict !== null} onRequestClose={actions.dismissConflict} testID="reservation-conflict-dialog">
        <IconBadge icon="alert-circle-outline" tone="info" />
        <Text style={styles.title} accessibilityRole="header">
          This changed
        </Text>
        <Text style={styles.message} testID="reservation-conflict-message">
          {actions.conflict ?? ''}
        </Text>
        <Button title="OK, reload" leftIcon="refresh" onPress={actions.dismissConflict} testID="reservation-conflict-ok" />
      </DialogFrame>
    </>
  );
}

type ReservedTableSheetProps = {
  table: TableView | null;
  actions: ReservationActionsState;
  time: (iso: string) => string;
  onClose: () => void;
};

/**
 * Sell → Tables, a **reserved** table was tapped (Table Management §F):
 * `Reserved for Santos · 4 guests · 7:00 PM`, with **Seat now** (opens the
 * bill with `reservation_ulid`), **Cancel** and **No-show**.
 */
export function ReservedTableSheet({ table, actions, time, onClose }: ReservedTableSheetProps) {
  const { isSmallPhone } = useResponsive();
  const now = useNow(CLOCK_MS);
  const target = table ? targetOfTable(table) : null;
  const seating = target !== null && actions.seatingUlid === target.ulid;
  // §E.5: no-show only once its time has come (the server answers 409 earlier).
  const early = target !== null && Date.parse(target.reservedFor) > now;

  function later(kind: 'cancel' | 'no_show') {
    if (!target) return;
    onClose();
    actions.ask(kind, target);
  }

  return (
    <BottomSheet visible={table !== null && target !== null} onClose={seating ? () => undefined : onClose} closeLabel="Close" testID="reserved-sheet">
      <ScrollView contentContainerStyle={styles.sheet}>
        {table && target ? (
          <>
            <Text style={styles.title} accessibilityRole="header">
              {tableLabel(table.name)}
            </Text>
            <Text style={styles.message} testID="reserved-sheet-summary">
              {reservedForLabel(target.guestName, target.partySize, time(target.reservedFor))}
            </Text>
            {table.reservation?.is_late ? <Banner message="The guests are late." variant="warning" testID="reserved-sheet-late" /> : null}
            {actions.seatError ? <Banner message={actions.seatError} testID="reserved-sheet-error" /> : null}
            <Button
              title="Seat now"
              leftIcon="restaurant-outline"
              size="lg"
              onPress={() => actions.seat(target, onClose)}
              loading={seating}
              disabled={seating}
              accessibilityHint="Opens the bill for this reservation"
              testID="reserved-sheet-seat"
            />
            <View style={[styles.row, isSmallPhone && styles.stacked]}>
              <Button
                title="Cancel reservation"
                variant="danger"
                onPress={() => later('cancel')}
                disabled={seating}
                style={styles.action}
                testID="reserved-sheet-cancel"
              />
              <Button
                title={early && target ? `No-show from ${time(target.reservedFor)}` : 'No-show'}
                variant="secondary"
                onPress={() => later('no_show')}
                disabled={seating || early}
                style={styles.action}
                testID="reserved-sheet-no-show"
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stacked: {
    flexDirection: 'column',
  },
  action: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
