import { useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type TextInput } from 'react-native';

import { AmountRow } from '@/components/shared/AmountRow';
import { ShiftPrintStatus } from '@/components/shifts/ShiftPrintStatus';
import { ShiftReportView, VarianceLine } from '@/components/shifts/ShiftReportView';
import { shiftSinceLabel } from '@/components/shifts/ShiftPill';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogFrame } from '@/components/ui/DialogFrame';
import type { IconName } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { ListRow } from '@/components/ui/ListRow';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { CLOSE_BLOCKED_MESSAGE, type ShiftControls } from '@/hooks/shifts/useShiftControls';
import { useResponsive } from '@/hooks/useResponsive';
import { SHIFT_LIMITS } from '@/shifts/shiftForms';
import { useSessionStore } from '@/stores/session';
import { formatPeso } from '@/utils/money';

type DialogProps = { controls: ShiftControls };

type MenuAction = {
  key: 'cash_in' | 'cash_out' | 'x_read' | 'close';
  label: string;
  icon: IconName;
  /** Why it can't be used (shown under it), or `null`. */
  disabledReason: string | null;
  danger?: boolean;
};

function MenuRow({ action, onPress }: { action: MenuAction; onPress: () => void }) {
  return (
    <ListRow
      label={action.label}
      icon={action.icon}
      tone="primary"
      onPress={onPress}
      subLabel={action.disabledReason}
      accessibilityHint={action.disabledReason ?? undefined}
      disabled={action.disabledReason !== null}
      danger={action.danger}
      divider
      style={styles.menuRow}
      testID={`shift-menu-${action.key}`}
    />
  );
}

/** The shift menu: Cash in, Cash out, X-read, Close shift (each needs its permission). */
export function ShiftMenuDialog({ controls }: DialogProps) {
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const { shift } = controls;
  if (!shift) return null;

  const needsOpen = controls.canOpen ? null : 'Needs permission to open shifts.';
  let closeReason: string | null = null;
  if (!controls.canClose) closeReason = 'Needs permission to close shifts.';
  else if (controls.closeBlocked) closeReason = CLOSE_BLOCKED_MESSAGE;

  const actions: MenuAction[] = [
    { key: 'cash_in', label: 'Cash in', icon: 'arrow-down-circle-outline', disabledReason: needsOpen },
    { key: 'cash_out', label: 'Cash out', icon: 'arrow-up-circle-outline', disabledReason: needsOpen },
    { key: 'x_read', label: 'X-read', icon: 'document-text-outline', disabledReason: needsOpen },
    { key: 'close', label: 'Close shift', icon: 'lock-closed-outline', disabledReason: closeReason, danger: true },
  ];

  return (
    <DialogFrame visible={controls.dialog === 'menu'} onRequestClose={controls.dismiss} testID="shift-menu">
      <Text style={styles.title} accessibilityRole="header">
        {shiftSinceLabel(shift, timeZone)}
      </Text>
      <Text style={styles.subtitle}>
        Opened by {shift.openedBy.name} · Starting cash {formatPeso(shift.openingFloatCents)}
      </Text>
      <View>
        {actions.map((action) => (
          <MenuRow key={action.key} action={action} onPress={() => controls.show(action.key)} />
        ))}
      </View>
      <Button title="Cancel" variant="secondary" onPress={controls.dismiss} testID="shift-menu-cancel" />
    </DialogFrame>
  );
}

/** Cash in / Cash out: an amount and a reason (required, max 120). Saved on the tablet, synced by the outbox. */
export function CashMovementDialog({ controls }: DialogProps) {
  const { cash } = controls;
  const reasonRef = useRef<TextInput>(null);
  const visible = controls.dialog === 'cash_in' || controls.dialog === 'cash_out';
  const title = cash.type === 'in' ? 'Cash in' : 'Cash out';
  return (
    <ConfirmDialog
      visible={visible}
      title={title}
      message={cash.type === 'in' ? 'Cash put into the drawer.' : 'Cash taken out of the drawer.'}
      icon={cash.type === 'in' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
      confirmLabel={`Record ${title.toLowerCase()}`}
      busy={controls.busy}
      error={cash.error}
      onConfirm={cash.submit}
      onCancel={controls.dismiss}
      testID="cash-dialog"
    >
      <Input
        label="Amount"
        prefix="₱"
        value={cash.amount}
        onChangeText={cash.setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        error={cash.amountError}
        editable={!controls.busy}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => reasonRef.current?.focus()}
        testID="cash-amount"
      />
      <Input
        label="Reason"
        value={cash.reason}
        onChangeText={cash.setReason}
        placeholder={cash.type === 'in' ? 'e.g. Change fund' : 'e.g. Paid the supplier'}
        maxLength={SHIFT_LIMITS.maxReasonLength}
        error={cash.reasonError}
        editable={!controls.busy}
        ref={reasonRef}
        returnKeyType="done"
        onSubmitEditing={cash.submit}
        testID="cash-reason"
      />
    </ConfirmDialog>
  );
}

function ReportState({ controls, counted }: DialogProps & { counted: number | null }) {
  const { report, shift } = controls;
  if (report.loading) {
    return (
      <View style={styles.loading} testID="shift-report-loading">
        <ActivityIndicator color={colors.primaryBright} />
        <Text style={styles.subtitle}>Adding up the shift…</Text>
      </View>
    );
  }
  if (report.error || !report.value || !shift) {
    return (
      <View style={styles.stack}>
        <Banner message={report.error ?? "The shift report couldn't be read."} testID="shift-report-error" />
        <Button title="Retry" leftIcon="refresh" variant="tonal" onPress={controls.retryReport} testID="shift-report-retry" />
      </View>
    );
  }
  return (
    <ShiftReportView
      report={report.value}
      openingFloatCents={shift.openingFloatCents}
      countedCashCents={counted}
      testID="x-read-report"
    />
  );
}

/** X-read (`shift.open`): the open shift's report from this tablet's data, with Print. */
export function XReadDialog({ controls }: DialogProps) {
  const { xRead } = controls;
  return (
    <DialogFrame visible={controls.dialog === 'x_read'} onRequestClose={controls.dismiss} busy={controls.busy} testID="x-read-dialog">
      <Text style={styles.title} accessibilityRole="header">
        X-read
      </Text>
      <Text style={styles.subtitle}>This shift so far, from the sales on this tablet. For internal use.</Text>
      <ReportState controls={controls} counted={null} />
      {xRead.print ? <ShiftPrintStatus jobIds={xRead.print.jobIds} notice={xRead.print.notice} testID="x-read-status" /> : null}
      <View style={styles.actions}>
        <Button title="Close" variant="secondary" onPress={controls.dismiss} disabled={controls.busy} style={styles.action} testID="x-read-close" />
        <Button
          title="Print X-read"
          leftIcon="print-outline"
          onPress={xRead.submit}
          loading={controls.busy}
          disabled={!controls.report.value}
          style={styles.action}
          testID="x-read-print"
        />
      </View>
    </DialogFrame>
  );
}

/**
 * Close shift (`shift.close`): 1. enter the counted cash; the dialog shows
 * the expected cash and the variance. 2. Confirm: the shift closes, the Z-read
 * prints, and Sell goes back to "Open a shift".
 */
export function CloseShiftDialog({ controls }: DialogProps) {
  const { close, report } = controls;
  const { isSmallPhone } = useResponsive();
  const noteRef = useRef<TextInput>(null);
  const expected = close.expectedCents;
  const ready = !report.loading && expected !== null;

  return (
    <DialogFrame visible={controls.dialog === 'close'} onRequestClose={controls.dismiss} busy={controls.busy} testID="close-shift-dialog">
      <Text style={styles.title} accessibilityRole="header">
        {close.step === 'confirm' ? 'Close this shift?' : 'Close shift'}
      </Text>
      {close.error ? <Banner message={close.error} testID="close-shift-error" /> : null}

      {report.loading ? (
        <View style={styles.loading} testID="shift-report-loading">
          <ActivityIndicator color={colors.primaryBright} />
          <Text style={styles.subtitle}>Adding up the shift…</Text>
        </View>
      ) : null}
      {report.error ? (
        <View style={styles.stack}>
          <Banner message={report.error} testID="shift-report-error" />
          <Button title="Retry" leftIcon="refresh" variant="tonal" onPress={controls.retryReport} testID="shift-report-retry" />
        </View>
      ) : null}

      {ready && close.step === 'count' ? (
        <View style={styles.stack}>
          <Text style={styles.subtitle}>Count the cash in the drawer and enter the total.</Text>
          <AmountRow label="Expected cash" cents={expected} variant="strong" testID="close-expected" />
          <Input
            label="Counted cash"
            prefix="₱"
            value={close.counted}
            onChangeText={close.setCounted}
            keyboardType="decimal-pad"
            placeholder="0.00"
            error={close.countedError}
            editable={!controls.busy}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => noteRef.current?.focus()}
            testID="close-counted"
          />
          {close.liveVariance !== null ? <VarianceLine varianceCents={close.liveVariance} testID="close-variance" /> : null}
          <Input
            label="Note (optional)"
            value={close.note}
            onChangeText={close.setNote}
            placeholder="e.g. Why the drawer is short"
            maxLength={SHIFT_LIMITS.maxCloseNoteLength}
            multiline
            error={close.noteError}
            editable={!controls.busy}
            ref={noteRef}
            testID="close-note"
          />
        </View>
      ) : null}

      {ready && close.step === 'confirm' && close.countedCents !== null && close.liveVariance !== null ? (
        <View style={styles.stack} testID="close-confirm">
          <AmountRow label="Expected cash" cents={expected} />
          <AmountRow label="Counted cash" cents={close.countedCents} variant="strong" />
          <VarianceLine varianceCents={close.liveVariance} testID="close-confirm-variance" />
          <Text style={styles.subtitle}>
            Closing ends this shift on the tablet and prints the Z-read. It can&apos;t be undone.
          </Text>
        </View>
      ) : null}

      <View style={[styles.actions, isSmallPhone && styles.actionsStacked]}>
        <Button
          title={close.step === 'confirm' ? 'Back' : 'Cancel'}
          variant="secondary"
          onPress={close.step === 'confirm' ? close.back : controls.dismiss}
          disabled={controls.busy}
          style={styles.action}
          testID="close-shift-cancel"
        />
        {close.step === 'confirm' ? (
          <Button
            title="Close shift"
            variant="danger"
            leftIcon="lock-closed-outline"
            onPress={close.confirm}
            loading={controls.busy}
            style={styles.action}
            testID="close-shift-confirm"
          />
        ) : (
          <Button
            title="Review"
            onPress={close.review}
            disabled={!ready || controls.closeBlocked}
            style={styles.action}
            testID="close-shift-review"
          />
        )}
      </View>
    </DialogFrame>
  );
}

/** Every shift dialog of the Sell screen. */
export function ShiftDialogs({ controls }: DialogProps) {
  return (
    <>
      <ShiftMenuDialog controls={controls} />
      <CashMovementDialog controls={controls} />
      <XReadDialog controls={controls} />
      <CloseShiftDialog controls={controls} />
    </>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  menuRow: {
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  loading: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  stack: {
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  actionsStacked: {
    flexDirection: 'column-reverse',
  },
  action: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
