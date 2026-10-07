import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View, type TextInput } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailColumns, RecordHeaderCard } from '@/components/purchasing/PurchaseDetailParts';
import { lineTestID, PurchaseOrderLineCard, ReceiptHistoryCard, usePurchaseOrderLineColumns } from '@/components/purchasing/PurchaseOrderParts';
import { SupplierPickerField } from '@/components/purchasing/PurchasePickers';
import { chipFor, PO_RECEIVING_STATUS, PO_STATUS, PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { TimelineCard } from '@/components/purchasing/TimelineCard';
import { DateField } from '@/components/shared/DateField';
import { SectionLabel } from '@/components/shared/FormSection';
import { DetailRow } from '@/components/shared/InfoCard';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { useLatestCallback } from '@/components/shared/useLatestCallback';
import { QtyUnitField } from '@/components/units/QtyUnitField';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable } from '@/components/ui/DataTable';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { TopBar } from '@/components/ui/TopBar';
import { purchaseRequestRoute, receiveRoute, ROUTES } from '@/constants/routes';
import { colors, layout, spacing, typography } from '@/constants/theme';
import { PO_LIMITS, usePurchaseOrder, usePurchaseOrderActions, type PurchaseOrderActionsState } from '@/hooks/purchasing/usePurchaseOrders';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useResponsive } from '@/hooks/useResponsive';
import { ApiError } from '@/services/api';
import type { PurchaseOrderLine } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatBusinessDate } from '@/utils/dates';
import { formatPeso } from '@/utils/money';
import { goBackOr } from '@/utils/navigation';
import { formatQtyUnit } from '@/utils/quantity';

function backToList() {
  goBackOr(ROUTES.purchaseOrders);
}

function lineKey(line: PurchaseOrderLine): string {
  return String(line.id);
}

/** A table row's spoken summary (on its first cell: the Edit button stays reachable). */
function lineAccessibilityLabel(line: PurchaseOrderLine): string {
  return `${line.item.name}, ${formatQtyUnit(line.qty, line.unit)}, from ${line.supplier.name}`;
}

const NOT_FOUND = new ApiError('This purchase order was not found.', { status: 404, kind: 'http' });

/** Edit one line while the order is pending: qty + unit (live base preview), unit price, supplier. */
function LineEditDialog({ actions }: { actions: PurchaseOrderActionsState }) {
  const edit = actions.line.state;
  const choices = actions.line.choices;
  const busy = actions.busy === 'line';
  const priceRef = useRef<TextInput>(null);
  return (
    <ConfirmDialog
      visible={edit !== null}
      title="Edit line"
      message={edit ? edit.line.item.name : undefined}
      confirmLabel="Save line"
      icon="create-outline"
      busy={busy}
      confirmDisabled={choices === null}
      error={actions.line.banner}
      onConfirm={actions.line.save}
      onCancel={actions.line.cancel}
      testID="po-line-dialog"
    >
      {edit && choices ? (
        <QtyUnitField
          label="Quantity"
          qty={edit.qty}
          onQtyChange={(qty) => actions.line.set({ qty })}
          unit={edit.unit}
          onUnitChange={(unit) => actions.line.set({ unit })}
          choices={choices}
          error={edit.errors.qty}
          unitError={edit.errors.unit}
          editable={!busy}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => priceRef.current?.focus()}
          testID="po-line-dialog"
        />
      ) : (
        <Text style={styles.muted}>Loading the item’s units…</Text>
      )}
      {edit ? (
        <>
          <Input
            label={`Unit price per ${edit.unit}`}
            prefix="₱"
            value={edit.price}
            onChangeText={(price) => actions.line.set({ price })}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={edit.errors.price}
            editable={!busy}
            ref={priceRef}
            returnKeyType="done"
            testID="po-line-dialog-price"
          />
          <SupplierPickerField value={edit.supplier} onChange={(supplier) => actions.line.set({ supplier })} error={edit.errors.supplier} disabled={busy} testID="po-line-dialog-supplier" />
        </>
      ) : null}
    </ConfirmDialog>
  );
}

/**
 * One purchase order (§L; Sage "Purchasing" board): the head card (PO
 * number, its PR, who created and approved it, status and receiving chips,
 * the decline reason, expected delivery, remarks, the total), **Approve**
 * (primary) / **Decline** (outlined red, with a reason) while pending, line
 * and delivery edits while pending, **Receive** once approved, the lines
 * table (cards on phones), then the receipts beside the timeline (tablet
 * landscape). Needs a connection.
 */
export function PurchaseOrderDetailScreen({ ulid }: { ulid: string | null }) {
  const query = usePurchaseOrder(ulid);
  const po = query.data ?? null;
  const actions = usePurchaseOrderActions(po);
  const permissions = usePurchasingPermissions();
  const online = useIsOnline();
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const { isTablet, isLandscape, screenPaddingX, screenPaddingY, gutter, contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const pending = po?.status === 'pending_approval';
  const approved = po?.status === 'approved';
  const canEdit = pending && online && (permissions.canRequest || permissions.canApprove);
  const blocked = actions.busy !== null;
  const openLine = useLatestCallback((line: PurchaseOrderLine) => actions.line.open(line));
  const onEdit = canEdit ? openLine : undefined;
  const columns = usePurchaseOrderLineColumns({ wide: isTablet && isLandscape, showReceiving: approved, onEdit, disabled: blocked });
  const renderCard = useCallback(
    (line: PurchaseOrderLine) => <PurchaseOrderLineCard line={line} showReceiving={approved} onEdit={onEdit} disabled={blocked} />,
    [approved, onEdit, blocked],
  );

  if (ulid === null || po === null) {
    let error: unknown = null;
    if (ulid === null) error = NOT_FOUND;
    else if (!online) error = new ApiError(PURCHASING_OFFLINE_MESSAGE, { status: null, kind: 'network' });
    else if (query.isError) error = query.error;
    return <RecordLoadState title="Purchase order" error={error} onRetry={() => void query.refetch()} onBack={backToList} testID="po-detail-state" />;
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  const status = chipFor(PO_STATUS, po.status);
  const receiving = chipFor(PO_RECEIVING_STATUS, po.receiving_status);
  const canDecide = pending && online && permissions.canApprove;
  const canReceive = approved && po.receiving_status !== 'fully_received' && permissions.canReceive && online;
  const decline = actions.decline.state;
  const delivery = actions.delivery.state;
  const meta = [`From ${po.purchase_request.pr_no}`];
  if (po.created_by) meta.push(`Created by ${po.created_by.name}`);
  const showReceipts = approved || po.receipts.length > 0;

  const header = (
    <View style={{ gap: gutter }}>
      {online ? null : <Banner variant="warning" message={PURCHASING_OFFLINE_MESSAGE} testID="po-detail-offline" />}
      {actions.notice ? <Banner variant="success" message={actions.notice} testID="po-detail-notice" /> : null}
      {actions.banner ? <Banner message={actions.banner} testID="po-detail-banner" /> : null}

      <RecordHeaderCard
        title={po.po_no}
        meta={meta.join(' · ')}
        chips={
          <>
            <Chip label={status.label} variant={status.variant} testID="po-detail-status" />
            {approved ? <Chip label={receiving.label} variant={receiving.variant} testID="po-detail-receiving" /> : null}
          </>
        }
        testID="po-detail-summary"
      >
        <View style={styles.details}>
          <View style={[styles.detail, styles.withAction]}>
            <View style={styles.flex}>
              <DetailRow label="From request" value={po.purchase_request.pr_no} testID="po-detail-pr" />
            </View>
            <Button
              title="Open"
              leftIcon="open-outline"
              variant="secondary"
              onPress={() => router.push(purchaseRequestRoute(po.purchase_request.ulid))}
              testID="po-detail-open-pr"
            />
          </View>
          <View style={styles.detail}>
            <DetailRow
              label="Expected delivery"
              value={po.expected_delivery_date ? formatBusinessDate(po.expected_delivery_date) : 'Not set'}
              testID="po-detail-delivery"
            />
          </View>
          {po.approved_by ? (
            <View style={styles.detail}>
              <DetailRow
                label="Approved by"
                value={`${po.approved_by.name}${po.approved_at ? ` · ${formatBranchDateTime(po.approved_at, timeZone) ?? po.approved_at}` : ''}`}
                testID="po-detail-approved"
              />
            </View>
          ) : null}
          {po.decline_reason ? (
            <View style={styles.detail}>
              <DetailRow label="Decline reason" value={po.decline_reason} testID="po-detail-decline-reason" />
            </View>
          ) : null}
        </View>
        {po.remarks ? <DetailRow label="Remarks" value={po.remarks} /> : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.total} testID="po-detail-total">
            {formatPeso(po.total_cents)}
          </Text>
        </View>
        {canDecide || canEdit || canReceive ? (
          <View style={styles.actions} testID="po-detail-actions">
            {canDecide ? (
              <Button title="Approve" leftIcon="checkmark-done-outline" onPress={actions.approve.open} disabled={blocked} style={styles.action} testID="po-detail-approve" />
            ) : null}
            {canDecide ? (
              <Button title="Decline" leftIcon="close" variant="danger" onPress={actions.decline.open} disabled={blocked} style={styles.action} testID="po-detail-decline" />
            ) : null}
            {canEdit ? (
              <Button
                title="Delivery & remarks"
                leftIcon="calendar-outline"
                variant="secondary"
                onPress={actions.delivery.open}
                disabled={blocked}
                style={styles.action}
                testID="po-detail-edit-delivery"
              />
            ) : null}
            {canReceive ? (
              <Button title="Receive" leftIcon="download-outline" onPress={() => router.push(receiveRoute(po.ulid))} style={styles.action} testID="po-detail-receive" />
            ) : null}
          </View>
        ) : null}
      </RecordHeaderCard>

      <View style={styles.linesTitle}>
        <SectionLabel>Lines</SectionLabel>
        <Text style={styles.muted}>{`${po.lines.length} ${po.lines.length === 1 ? 'line' : 'lines'}`}</Text>
      </View>
    </View>
  );

  const timeline = <TimelineCard entries={po.timeline} timeZone={timeZone} testID="po-detail-timeline" />;
  const footer = (
    <View style={{ paddingTop: gutter }}>
      {showReceipts ? <DetailColumns main={<ReceiptHistoryCard receipts={po.receipts} lines={po.lines} timeZone={timeZone} />} aside={timeline} /> : timeline}
    </View>
  );

  return (
    <Screen edges={[]} testID="po-detail-screen">
      <TopBar
        title={po.po_no}
        subtitle={status.label}
        left={<IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back" onPress={backToList} testID="po-detail-back" />}
        testID="po-detail-header"
      />
      <SafeAreaView edges={['left', 'right']} style={styles.fill}>
        <DataTable
          columns={columns}
          rows={po.lines}
          keyExtractor={lineKey}
          rowTestID={lineTestID}
          rowAccessibilityLabel={lineAccessibilityLabel}
          rowAccessible={false}
          renderCard={renderCard}
          rowHeight="auto"
          extraData={actions.busy}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.primaryBright]} tintColor={colors.primaryBright} />}
          contentContainerStyle={[
            styles.content,
            {
              maxWidth: isTablet ? contentMaxWidth : layout.receiptMaxWidth,
              paddingHorizontal: screenPaddingX,
              paddingTop: screenPaddingY,
              paddingBottom: insets.bottom + screenPaddingY + layout.tabBarHeight,
            },
          ]}
          testID="po-detail-scroll"
        />
      </SafeAreaView>

      <ConfirmDialog
        visible={actions.approve.visible}
        title="Approve this order?"
        message={`${po.po_no} for ${formatPeso(po.total_cents)} becomes ready for receiving.`}
        confirmLabel="Approve"
        icon="checkmark-done-outline"
        busy={actions.busy === 'approve'}
        onConfirm={actions.approve.confirm}
        onCancel={actions.approve.cancel}
        testID="po-approve-dialog"
      />
      <ConfirmDialog
        visible={decline !== null}
        title="Decline this order?"
        message={`${po.po_no} won't be received.`}
        confirmLabel="Decline"
        confirmVariant="danger"
        icon="close-circle-outline"
        busy={actions.busy === 'decline'}
        onConfirm={actions.decline.submit}
        onCancel={actions.decline.cancel}
        testID="po-decline-dialog"
      >
        <Input
          label="Reason"
          value={decline?.reason ?? ''}
          onChangeText={actions.decline.setReason}
          placeholder="e.g. Supplier can't deliver this week"
          maxLength={PO_LIMITS.reason}
          error={decline?.error}
          editable={actions.busy === null}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (actions.busy === null) actions.decline.submit();
          }}
          testID="po-decline-reason"
        />
      </ConfirmDialog>
      <LineEditDialog actions={actions} />
      <ConfirmDialog
        visible={delivery !== null}
        title="Delivery & remarks"
        confirmLabel="Save"
        icon="calendar-outline"
        busy={actions.busy === 'delivery'}
        error={actions.delivery.banner}
        onConfirm={actions.delivery.save}
        onCancel={actions.delivery.cancel}
        testID="po-delivery-dialog"
      >
        <DateField
          label="Expected delivery (optional)"
          value={delivery?.date ?? null}
          onChange={actions.delivery.setDate}
          error={delivery?.errors.date}
          disabled={actions.busy !== null}
          testID="po-delivery-date"
        />
        <Input
          label="Remarks (optional)"
          value={delivery?.remarks ?? ''}
          onChangeText={actions.delivery.setRemarks}
          multiline
          maxLength={PO_LIMITS.remarks}
          error={delivery?.errors.remarks}
          editable={actions.busy === null}
          testID="po-delivery-remarks"
        />
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
  details: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  detail: {
    flexGrow: 1,
    flexBasis: layout.sectionTitleMinWidth * 2,
  },
  withAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  totalLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  total: {
    ...typography.total,
    color: colors.primary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  action: {
    flexGrow: 1,
    flexBasis: layout.sectionTitleMinWidth,
  },
  linesTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  muted: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
