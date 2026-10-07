import { useRef } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';

import { ReceiptHistoryCard } from '@/components/purchasing/PurchaseOrderParts';
import { chipFor, LINE_STATUS, PO_RECEIVING_STATUS, PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { FormSection } from '@/components/shared/FormSection';
import { FormLayout } from '@/components/shared/FormLayout';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { QtyUnitField } from '@/components/units/QtyUnitField';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { ROUTES } from '@/constants/routes';
import { colors, numeric, radius, spacing, typography } from '@/constants/theme';
import { usePurchaseOrder } from '@/hooks/purchasing/usePurchaseOrders';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { lineField, RECEIVING_LIMITS, useReceiveScreen, type ReceiveScreenState } from '@/hooks/purchasing/useReceiving';
import { useIsOnline } from '@/hooks/useIsOnline';
import { ApiError } from '@/services/api';
import type { PurchaseOrder, PurchaseOrderLine } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { goBackOr } from '@/utils/navigation';
import { formatQtyUnit } from '@/utils/quantity';

function backToList() {
  goBackOr(ROUTES.receiving);
}

const NOT_FOUND = new ApiError('This purchase order was not found.', { status: 404, kind: 'http' });

/** One figure tile: the label over the value (`Ordered 2 sack` to a screen reader and in tests). */
function Figure({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureValue} numberOfLines={2} testID={testID}>
        <Text style={styles.figureLabel}>{`${label}
`}</Text>
        {value}
      </Text>
    </View>
  );
}

function ReceiveLine({ line, screen, disabled }: { line: PurchaseOrderLine; screen: ReceiveScreenState; disabled: boolean }) {
  const testID = `receive-line-${line.id}`;
  const entry = screen.entryOf(line);
  const choices = screen.choicesOf(line);
  const projection = screen.project(line);
  const chip = chipFor(LINE_STATUS, projection.status);
  const reasonRef = useRef<TextInput>(null);

  return (
    <Card style={styles.line} testID={testID}>
      <View style={styles.lineTop}>
        <View style={styles.flex}>
          <Text style={styles.name} numberOfLines={2}>
            {line.item.name}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {line.supplier.name}
          </Text>
        </View>
        <Chip
          label={projection.changed ? `${chip.label} after this` : chip.label}
          variant={chip.variant}
          icon={projection.status === 'over_received' ? 'warning-outline' : undefined}
          testID={`${testID}-status`}
        />
      </View>
      <View style={styles.figures}>
        <Figure label="Ordered" value={formatQtyUnit(line.qty, line.unit)} testID={`${testID}-ordered`} />
        <Figure label="Received" value={formatQtyUnit(line.received_qty, line.unit)} testID={`${testID}-received`} />
        <Figure label="Remaining" value={formatQtyUnit(line.remaining_qty, line.unit)} testID={`${testID}-remaining`} />
      </View>
      {choices ? (
        <QtyUnitField
          label={entry.correction ? 'Quantity to remove' : 'Quantity received now'}
          qty={entry.qty}
          onQtyChange={(qty) => screen.setQty(line, qty)}
          unit={entry.unit}
          onUnitChange={(unit) => screen.setUnit(line, unit)}
          choices={choices}
          error={screen.errors[lineField(line.id, 'qty')] ?? projection.belowZero}
          unitError={screen.errors[lineField(line.id, 'unit')]}
          editable={!disabled}
          returnKeyType={entry.correction ? 'next' : 'done'}
          submitBehavior={entry.correction ? 'submit' : undefined}
          onSubmitEditing={entry.correction ? () => reasonRef.current?.focus() : undefined}
          testID={testID}
        />
      ) : (
        <Text style={styles.muted}>Loading the item’s units…</Text>
      )}
      {projection.status === 'over_received' && projection.changed ? (
        <Text style={styles.warning} testID={`${testID}-over`}>
          More than ordered. It’s allowed: check the delivery note.
        </Text>
      ) : null}
      <SwitchRow
        label="Correction"
        description="Remove quantity that was received by mistake (a reason is needed)."
        value={entry.correction}
        onValueChange={(value) => screen.setCorrection(line, value)}
        disabled={disabled}
        testID={`${testID}-correction`}
      />
      {entry.correction ? (
        <Input
          label="Reason for the correction"
          value={entry.reason}
          onChangeText={(reason) => screen.setReason(line, reason)}
          placeholder="e.g. Counted wrong"
          maxLength={RECEIVING_LIMITS.reason}
          error={screen.errors[lineField(line.id, 'reason')]}
          editable={!disabled}
          ref={reasonRef}
          returnKeyType="done"
          testID={`${testID}-reason`}
        />
      ) : null}
    </Card>
  );
}

function ReceiveForm({ po }: { po: PurchaseOrder }) {
  const screen = useReceiveScreen(po);
  const online = useIsOnline();
  const { canReceive } = usePurchasingPermissions();
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const receiving = chipFor(PO_RECEIVING_STATUS, po.receiving_status);
  const approved = po.status === 'approved';
  const disabled = screen.busy || screen.locked || !online || !approved || !canReceive;

  return (
    <FormLayout
      title={`Receive ${po.po_no}`}
      subtitle={receiving.label}
      onBack={backToList}
      banner={screen.banner}
      notice={screen.notice}
      asidePlacement="end"
      testID="receive-screen"
      aside={<ReceiptHistoryCard receipts={po.receipts} lines={po.lines} timeZone={timeZone} />}
      main={
        <>
          {online ? null : <Banner variant="warning" message={PURCHASING_OFFLINE_MESSAGE} testID="receive-offline" />}
          {approved ? null : <Banner variant="warning" message="Approve the order before receiving." testID="receive-not-approved" />}
          <View style={styles.chips}>
            <Chip label={receiving.label} variant={receiving.variant} testID="receive-po-status" />
            <Text style={styles.muted}>{`From ${po.purchase_request.pr_no} · ${po.lines.length} ${po.lines.length === 1 ? 'line' : 'lines'}`}</Text>
          </View>
          {screen.errors.form ? <Banner message={screen.errors.form} testID="receive-form-error" /> : null}
          {po.lines.map((line) => (
            <ReceiveLine key={line.id} line={line} screen={screen} disabled={disabled} />
          ))}
          <FormSection title="Remarks">
            <Input
              label="Remarks (optional)"
              value={screen.remarks}
              onChangeText={screen.setRemarks}
              placeholder="e.g. DR #1234, delivered by Juan"
              multiline
              maxLength={RECEIVING_LIMITS.remarks}
              error={screen.errors.remarks}
              editable={!disabled}
              testID="receive-remarks"
            />
          </FormSection>
          {canReceive ? (
            <Button
              title={screen.locked ? 'Retry' : 'Save receipt'}
              leftIcon={screen.locked ? 'refresh' : 'download-outline'}
              size="lg"
              onPress={screen.submit}
              loading={screen.busy}
              disabled={screen.busy || !online || !approved}
              testID="receive-save"
            />
          ) : null}
        </>
      }
    />
  );
}

/**
 * Receive against an approved PO (§H, §L; `purchase.receive`): per line the
 * ordered, received and remaining quantities, a qty + unit entry with a live
 * status chip (`Over-received` as a warning), **Correction** (negative, with a
 * reason), remarks, and the receipts history beside (tablet landscape) or
 * below. Needs a connection.
 */
export function ReceiveScreen({ ulid }: { ulid: string | null }) {
  const query = usePurchaseOrder(ulid);
  const online = useIsOnline();

  if (ulid === null || !query.data) {
    let error: unknown = null;
    if (ulid === null) error = NOT_FOUND;
    else if (!online) error = new ApiError(PURCHASING_OFFLINE_MESSAGE, { status: null, kind: 'network' });
    else if (query.isError) error = query.error;
    return <RecordLoadState title="Receive" error={error} onRetry={() => void query.refetch()} onBack={backToList} testID="receive-state" />;
  }
  return <ReceiveForm po={query.data} />;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  line: {
    gap: spacing.md,
  },
  lineTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  muted: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  figures: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  figure: {
    flex: 1,
    minWidth: 0,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  figureLabel: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  figureValue: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  warning: {
    ...typography.bodySm,
    color: colors.warningText,
  },
});
