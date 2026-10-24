import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApproverPanel } from '@/components/pin/ApproverPanel';
import { guestsLabel, tableLabel } from '@/components/tables/tableLabels';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconBadge } from '@/components/ui/IconBadge';
import { Input } from '@/components/ui/Input';
import { LoadingState } from '@/components/ui/LoadingState';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { colors, spacing, typography } from '@/constants/theme';
import type { TabState } from '@/hooks/tables/useTab';
import { CANCEL_REASONS, type TabItemCancelState } from '@/hooks/tables/useTabItemCancel';
import type { TabMoveState } from '@/hooks/tables/useTabMove';
import { GUESTS_LIMITS } from '@/hooks/tables/useTablesView';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { Tab } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { REVERSAL_REASON_MAX } from '@pos/core/sale/refunds';
import { OTHER_REASON } from '@pos/core/sale/reversals';

const REASON_CHOICES = [...CANCEL_REASONS, OTHER_REASON];

function Actions({ children }: { children: ReactNode }) {
  const { isSmallPhone } = useResponsive();
  return <View style={[styles.actions, isSmallPhone && styles.stacked]}>{children}</View>;
}

/** **Cancel** a sent item: quantity, reason, and a manager's PIN without `sale.void` (§D.5). */
export function CancelItemDialog({ cancel }: { cancel: TabItemCancelState }) {
  const { isCompactHeight } = useResponsive();
  const { draft, picker } = cancel;
  return (
    <DialogFrame visible={draft !== null} onRequestClose={cancel.close} busy={cancel.submitting} testID="tab-cancel-dialog">
      {isCompactHeight ? null : <IconBadge icon="close-circle-outline" tone="danger" />}
      <Text style={styles.title} accessibilityRole="header">
        Cancel item
      </Text>
      {draft ? (
        <Text style={styles.message}>
          {draft.item.product_name} · {formatPeso(draft.item.unit_price_cents)} each. The kitchen gets a VOID ticket.
        </Text>
      ) : null}
      {cancel.banner ? <Banner variant={cancel.banner.variant} message={cancel.banner.message} testID="tab-cancel-banner" /> : null}
      {draft && draft.item.remaining_qty > 1 ? (
        <View style={styles.inline}>
          <Text style={styles.label}>Quantity</Text>
          <QtyStepper
            value={draft.qty}
            onChange={cancel.setQty}
            min={1}
            max={draft.item.remaining_qty}
            accessibilityLabel="Quantity to cancel"
            disabled={cancel.locked}
            testID="tab-cancel-qty"
          />
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.label}>Reason</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {REASON_CHOICES.map((reason, index) => (
            <ChoiceChip
              key={reason}
              label={reason}
              selected={cancel.choice === reason}
              onPress={() => cancel.choose(reason)}
              disabled={cancel.locked}
              testID={`tab-cancel-reason-${index}`}
            />
          ))}
        </View>
        {cancel.choice === OTHER_REASON ? (
          <Input
            label="What happened?"
            value={cancel.otherText}
            onChangeText={cancel.setOtherText}
            maxLength={REVERSAL_REASON_MAX}
            editable={!cancel.locked}
            error={cancel.reasonError}
            testID="tab-cancel-reason-text"
          />
        ) : cancel.reasonError ? (
          <Text style={styles.error} testID="tab-cancel-reason-error">
            {cancel.reasonError}
          </Text>
        ) : null}
      </View>
      {cancel.needsApproval ? (
        <View style={styles.section} testID="tab-cancel-approval">
          <Text style={styles.label}>Manager approval</Text>
          <Text style={styles.hint}>{picker.approval.reason ?? 'A manager must approve this cancel with their PIN.'}</Text>
          <ApproverPanel
            approval={picker.approval}
            approvers={picker.approvers}
            loading={picker.approversLoading}
            loadError={picker.approversError}
            onRetry={picker.retryApprovers}
            onChoose={picker.chooseApprover}
            onBack={picker.backToApprovers}
            onPinChange={picker.setApprovalPin}
            disabled={cancel.locked}
            emptyText="No one with a PIN can approve this. Ask a manager to set a PIN."
            testIDPrefix="tab-cancel-approval"
          />
        </View>
      ) : null}
      <Actions>
        <Button title="Keep item" variant="secondary" onPress={cancel.close} disabled={cancel.submitting} style={styles.action} testID="tab-cancel-keep" />
        <Button
          title={cancel.awaiting ? 'Retry' : 'Cancel item'}
          leftIcon={cancel.awaiting ? 'refresh' : 'close-circle-outline'}
          variant="danger"
          onPress={cancel.confirm}
          loading={cancel.submitting}
          disabled={!cancel.canConfirm}
          style={styles.action}
          testID="tab-cancel-confirm"
        />
      </Actions>
    </DialogFrame>
  );
}

/** **Transfer** to a free table, or **Merge** into another open bill (§D.8–9). */
export function MoveDialog({ move, tab }: { move: TabMoveState; tab: Tab }) {
  const { draft } = move;
  const transfer = draft?.kind === 'transfer';
  let list: ReactNode;
  if (move.loading) list = <LoadingState message="Loading tables…" testID="tab-move-loading" />;
  else if (move.loadError) {
    list = <ErrorState title="Couldn't load the tables" message={getErrorMessage(move.loadError)} onRetry={move.retry} testID="tab-move-error" />;
  } else if (move.choices.length === 0) {
    list = (
      <Text style={styles.hint} testID="tab-move-empty">
        {transfer ? 'No table is free right now.' : 'No other table has an open bill.'}
      </Text>
    );
  } else {
    list = (
      <View style={styles.chips} accessibilityRole="radiogroup">
        {move.choices.map((table) => (
          <ChoiceChip
            key={table.id}
            label={table.tab ? `${table.name} · ${formatPeso(table.tab.remaining_cents)}` : `${table.name}${table.area ? ` · ${table.area}` : ''}`}
            selected={draft?.target?.id === table.id}
            onPress={() => move.choose(table)}
            disabled={move.submitting}
            testID={`tab-move-table-${table.id}`}
          />
        ))}
      </View>
    );
  }
  return (
    <DialogFrame visible={draft !== null} onRequestClose={move.close} busy={move.submitting} testID="tab-move-dialog">
      <Text style={styles.title} accessibilityRole="header">
        {transfer ? 'Move to another table' : 'Merge into another bill'}
      </Text>
      <Text style={styles.message}>
        {transfer
          ? `${tableLabel(tab.table.name)}'s bill moves to the table you pick.`
          : `Everything still to pay on ${tableLabel(tab.table.name)} moves to the bill you pick, and the guests are added together.`}
      </Text>
      {list}
      {draft?.error ? <Banner message={draft.error} testID="tab-move-error-banner" /> : null}
      <Actions>
        <Button title="Cancel" variant="secondary" onPress={move.close} disabled={move.submitting} style={styles.action} testID="tab-move-cancel" />
        <Button
          title={transfer ? 'Move bill' : 'Merge bills'}
          leftIcon={transfer ? 'swap-horizontal' : 'git-merge-outline'}
          onPress={move.confirm}
          loading={move.submitting}
          disabled={!draft?.target || move.submitting}
          style={styles.action}
          testID="tab-move-confirm"
        />
      </Actions>
    </DialogFrame>
  );
}

/** Guests (`PATCH /tabs/{ulid}`), the `409` dialog that reloads the tab, and the Close confirmation. */
export function TabStateDialogs({ state, tab }: { state: TabState; tab: Tab | null }) {
  return (
    <>
      <DialogFrame visible={state.guestsDraft !== null} onRequestClose={state.cancelGuests} busy={state.busy === 'guests'} testID="tab-guests-dialog">
        <Text style={styles.title} accessibilityRole="header">
          Guests
        </Text>
        <View style={styles.inline}>
          <Text style={styles.label}>{state.guestsDraft !== null ? guestsLabel(state.guestsDraft) : ''}</Text>
          <QtyStepper
            value={state.guestsDraft ?? GUESTS_LIMITS.min}
            onChange={state.setGuestsDraft}
            min={GUESTS_LIMITS.min}
            max={GUESTS_LIMITS.max}
            accessibilityLabel="Guests"
            disabled={state.busy === 'guests'}
            testID="tab-guests-stepper"
          />
        </View>
        {state.guestsError ? <Banner message={state.guestsError} testID="tab-guests-error" /> : null}
        <Actions>
          <Button title="Cancel" variant="secondary" onPress={state.cancelGuests} disabled={state.busy === 'guests'} style={styles.action} testID="tab-guests-cancel" />
          <Button
            title="Save"
            leftIcon="checkmark"
            onPress={state.saveGuests}
            loading={state.busy === 'guests'}
            disabled={state.busy === 'guests'}
            style={styles.action}
            testID="tab-guests-save"
          />
        </Actions>
      </DialogFrame>

      <DialogFrame visible={state.conflict !== null} onRequestClose={state.dismissConflict} testID="tab-conflict-dialog">
        <IconBadge icon="alert-circle-outline" tone="info" />
        <Text style={styles.title} accessibilityRole="header">
          This bill changed
        </Text>
        <Text style={styles.message} testID="tab-conflict-message">
          {state.conflict ?? ''}
        </Text>
        <Button title="Reload the bill" leftIcon="refresh" onPress={state.dismissConflict} testID="tab-conflict-ok" />
      </DialogFrame>

      <ConfirmDialog
        visible={state.closeAsked}
        title="Close this bill?"
        message={tab ? `${tableLabel(tab.table.name)} becomes free. Nothing is left to pay.` : undefined}
        confirmLabel="Close bill"
        icon="checkmark-done"
        busy={state.busy === 'close'}
        onConfirm={state.confirmClose}
        onCancel={state.cancelClose}
        testID="tab-close-dialog"
      />
    </>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  hint: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  section: {
    gap: spacing.sm,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  stacked: {
    flexDirection: 'column-reverse',
  },
  action: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
