import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailColumns, RecordHeaderCard, SummaryCard, SummaryDivider, SummaryLine } from '@/components/purchasing/PurchaseDetailParts';
import { PdfButton, PdfErrorBanner, PurchasePdfSheet } from '@/components/purchasing/PurchasePdf';
import { estimateTotalCents, itemEstimateCents } from '@/components/purchasing/PurchaseRequestCard';
import { chipFor, DECISION, PO_STATUS, PR_STATUS, PURCHASING_OFFLINE_MESSAGE, SELF_APPROVAL_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { TimelineCard } from '@/components/purchasing/TimelineCard';
import { SectionLabel } from '@/components/shared/FormSection';
import { DetailRow } from '@/components/shared/InfoCard';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { useLatestCallback } from '@/components/shared/useLatestCallback';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CellText, DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { TopBar } from '@/components/ui/TopBar';
import { editPurchaseRequestRoute, purchaseOrderRoute, ROUTES } from '@/constants/routes';
import { colors, layout, numeric, spacing, typography } from '@/constants/theme';
import { DECISION_REASON_MAX, isUndecided, usePurchaseRequest, usePurchaseRequestActions } from '@/hooks/purchasing/usePurchaseRequests';
import { usePurchasePdf } from '@/hooks/purchasing/usePurchasePdf';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useResponsive } from '@/hooks/useResponsive';
import { ApiError } from '@/services/api';
import type { PurchaseDecision, PurchaseRequest, PurchaseRequestItem } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatBusinessDate } from '@/utils/dates';
import { formatPeso } from '@pos/core/money';
import { goBackOr } from '@/utils/navigation';
import { formatQtyUnit } from '@pos/core/quantity';

function backToList() {
  goBackOr(ROUTES.purchaseRequests);
}

function itemKey(item: PurchaseRequestItem): string {
  return String(item.id);
}

function itemTestID(item: PurchaseRequestItem): string {
  return `pr-detail-item-${item.id}`;
}

/** A table row's spoken summary (on its first cell: the Approve / Decline buttons stay reachable). */
function itemAccessibilityLabel(item: PurchaseRequestItem): string {
  return `${item.item.name}, ${formatQtyUnit(item.qty, item.unit)}, from ${item.supplier.name}`;
}

const NOT_FOUND = new ApiError('This purchase request was not found.', { status: 404, kind: 'http' });

/** `Approved by Maria Owner · 29 Sep 2026, 9:10 AM`. */
function decidedText(item: PurchaseRequestItem, timeZone: string): string {
  const decision = DECISION[item.decision];
  const who = item.decided_by ? `${decision.label} by ${item.decided_by.name}` : decision.label;
  return item.decided_at ? `${who} · ${formatBranchDateTime(item.decided_at, timeZone) ?? item.decided_at}` : who;
}

/** `Est. ₱1,200.00 / sack`, or `No estimated price`. */
function unitEstimateText(item: PurchaseRequestItem): string {
  return item.estimated_unit_price_cents === null ? 'No estimated price' : `Est. ${formatPeso(item.estimated_unit_price_cents)} / ${item.unit}`;
}

type DecideProps = {
  item: PurchaseRequestItem;
  busy: string | null;
  onApprove: (item: PurchaseRequestItem) => void;
  onDecline: (item: PurchaseRequestItem) => void;
};

/** **Approve** (primary) and **Decline** (outlined red) for one pending item. */
function DecideButtons({ item, busy, onApprove, onDecline }: DecideProps) {
  const testID = itemTestID(item);
  return (
    <View style={styles.decide}>
      <Button
        title="Approve"
        leftIcon="checkmark"
        onPress={() => onApprove(item)}
        loading={busy === `approve-${item.id}`}
        disabled={busy !== null}
        style={styles.decideButton}
        testID={`${testID}-approve`}
      />
      <Button title="Decline" leftIcon="close" variant="danger" onPress={() => onDecline(item)} disabled={busy !== null} style={styles.decideButton} testID={`${testID}-decline`} />
    </View>
  );
}

/** The decision: its chip, who decided and when, and the reason. */
function DecisionLines({ item, timeZone }: { item: PurchaseRequestItem; timeZone: string }) {
  const decision = DECISION[item.decision];
  const testID = itemTestID(item);
  return (
    <>
      <Chip label={decision.label} variant={decision.variant} testID={`${testID}-decision`} />
      {item.decision !== 'pending' ? (
        <Text style={styles.muted} numberOfLines={2} testID={`${testID}-decided`}>
          {decidedText(item, timeZone)}
        </Text>
      ) : null}
      {item.decision_reason ? (
        <Text style={styles.reason} numberOfLines={3} testID={`${testID}-reason`}>
          Reason: {item.decision_reason}
        </Text>
      ) : null}
    </>
  );
}

type ItemCardProps = {
  item: PurchaseRequestItem;
  timeZone: string;
  /** Approve / Decline show (the item is pending and the user can decide). */
  decidable: boolean;
  busy: string | null;
  onApprove: (item: PurchaseRequestItem) => void;
  onDecline: (item: PurchaseRequestItem) => void;
};

/** Portrait and phones (MASTER §6): one PR item as a card (what, from whom, how much, the estimate, the decision, and Approve / Decline). */
const ItemCard = memo(function ItemCard({ item, timeZone, decidable, busy, onApprove, onDecline }: ItemCardProps) {
  const testID = itemTestID(item);
  const estimate = itemEstimateCents(item);
  return (
    <Card style={styles.item} testID={testID}>
      <View style={styles.itemTop}>
        <View style={styles.flex}>
          <Text style={styles.itemName} numberOfLines={2}>
            {item.item.name}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {item.item.type === 'product' ? 'Product' : 'Ingredient'} · {item.supplier.name}
          </Text>
        </View>
        <Text style={styles.qty} testID={`${testID}-qty`}>
          {formatQtyUnit(item.qty, item.unit)}
        </Text>
      </View>
      <Text style={styles.muted} testID={`${testID}-estimate`}>
        {unitEstimateText(item)}
        {estimate !== null ? ` · ${formatPeso(estimate)}` : ''}
      </Text>
      {item.remarks ? <Text style={styles.body}>{item.remarks}</Text> : null}
      <View style={styles.decision}>
        <DecisionLines item={item} timeZone={timeZone} />
      </View>
      {decidable ? <DecideButtons item={item} busy={busy} onApprove={onApprove} onDecline={onDecline} /> : null}
    </Card>
  );
});

type ColumnOptions = {
  timeZone: string;
  canDecide: boolean;
  busy: string | null;
  onApprove: (item: PurchaseRequestItem) => void;
  onDecline: (item: PurchaseRequestItem) => void;
  wide: boolean;
};

/**
 * The items table (Sage "Purchasing" board): ingredient, supplier, qty,
 * est. total and the decision (the chip, who decided, the reason, and
 * Approve / Decline while it can be decided). Tablet portrait folds the
 * supplier under the ingredient. Cells keep the card test IDs
 * (`pr-detail-item-<id>-qty`, `-estimate`, `-decision`, `-decided`, `-reason`, `-approve`, `-decline`).
 */
function useItemColumns({ timeZone, canDecide, busy, onApprove, onDecline, wide }: ColumnOptions): DataTableColumn<PurchaseRequestItem>[] {
  return useMemo(() => {
    const name: DataTableColumn<PurchaseRequestItem> = {
      key: 'item',
      header: 'Item',
      flex: 1.3,
      render: (item) => (
        <>
          <CellText variant="strong" numberOfLines={2}>
            {item.item.name}
          </CellText>
          <CellText variant="muted" numberOfLines={2}>
            {wide ? (item.item.type === 'product' ? 'Product' : 'Ingredient') : item.supplier.name}
            {item.remarks ? ` · ${item.remarks}` : ''}
          </CellText>
        </>
      ),
    };
    const supplier: DataTableColumn<PurchaseRequestItem> = {
      key: 'supplier',
      header: 'Supplier',
      flex: 1,
      render: (item) => (
        <CellText numberOfLines={2} style={styles.resting}>
          {item.supplier.name}
        </CellText>
      ),
    };
    const qty: DataTableColumn<PurchaseRequestItem> = {
      key: 'qty',
      header: 'Qty',
      flex: 0.7,
      align: 'right',
      render: (item) => (
        <CellText align="right" testID={`${itemTestID(item)}-qty`}>
          {formatQtyUnit(item.qty, item.unit)}
        </CellText>
      ),
    };
    const estimate: DataTableColumn<PurchaseRequestItem> = {
      key: 'estimate',
      header: 'Est. total',
      headerAccessibilityLabel: 'Estimated total',
      flex: 0.9,
      align: 'right',
      render: (item) => {
        const total = itemEstimateCents(item);
        return (
          <>
            <CellText variant="strong" align="right" testID={`${itemTestID(item)}-estimate`}>
              {total === null ? '—' : formatPeso(total)}
            </CellText>
            {item.estimated_unit_price_cents !== null ? (
              <CellText variant="muted" align="right">
                {`${formatPeso(item.estimated_unit_price_cents)} / ${item.unit}`}
              </CellText>
            ) : null}
          </>
        );
      },
    };
    const decision: DataTableColumn<PurchaseRequestItem> = {
      key: 'decision',
      header: 'Decision',
      flex: canDecide ? 1.7 : 1.3,
      render: (item) => (
        <View style={styles.decision}>
          <DecisionLines item={item} timeZone={timeZone} />
          {canDecide && item.decision === 'pending' ? <DecideButtons item={item} busy={busy} onApprove={onApprove} onDecline={onDecline} /> : null}
        </View>
      ),
    };
    return wide ? [name, supplier, qty, estimate, decision] : [name, qty, estimate, decision];
  }, [timeZone, canDecide, busy, onApprove, onDecline, wide]);
}

/** `2 items · ₱2,400.00` (the estimate only when every one of them has one). */
function decisionTotal(pr: PurchaseRequest, decision: PurchaseDecision): string {
  const count = pr.items.filter((item) => item.decision === decision).length;
  const total = count > 0 ? estimateTotalCents(pr.items, decision) : null;
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  return total === null ? items : `${items} · ${formatPeso(total)}`;
}

/**
 * One purchase request (§L), structured like the PO detail: the head card
 * (PR number and status badge, then labelled details: requested by, date
 * needed, the PO with **Open** and its PDF, remarks) with the actions
 * (**Approve all remaining**, **Edit**, **Cancel request** while nothing is
 * decided), the items (a table in tablet landscape, cards in portrait and on
 * phones) with **Approve** / **Decline** per item for those who can decide (a
 * decline asks for a reason), then the decision history beside a summary
 * card (tablet landscape). The PR PDF sits in the top bar. Pull-to-refresh.
 * Needs a connection.
 */
export function PurchaseRequestDetailScreen({ ulid }: { ulid: string | null }) {
  const query = usePurchaseRequest(ulid);
  const pr = query.data ?? null;
  const actions = usePurchaseRequestActions(pr);
  const pdf = usePurchasePdf();
  const permissions = usePurchasingPermissions();
  const online = useIsOnline();
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const { isTablet, isLandscape, screenPaddingX, screenPaddingY, gutter, contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const canDecide = permissions.canApprove && online && pr?.status === 'pending_approval';
  const onApprove = useLatestCallback((item: PurchaseRequestItem) => actions.approve(item.id, item.item.name));
  const onDecline = useLatestCallback((item: PurchaseRequestItem) => actions.decline.open(item.id, item.item.name));
  const columns = useItemColumns({ timeZone, canDecide, busy: actions.busy, onApprove, onDecline, wide: isTablet && isLandscape });
  const busy = actions.busy;
  const renderCard = useCallback(
    (item: PurchaseRequestItem) => (
      <ItemCard
        item={item}
        timeZone={timeZone}
        decidable={canDecide && item.decision === 'pending'}
        busy={busy}
        onApprove={onApprove}
        onDecline={onDecline}
      />
    ),
    [timeZone, canDecide, busy, onApprove, onDecline],
  );

  if (ulid === null || pr === null) {
    let error: unknown = null;
    if (ulid === null) error = NOT_FOUND;
    else if (!online) error = new ApiError(PURCHASING_OFFLINE_MESSAGE, { status: null, kind: 'network' });
    else if (query.isError) error = query.error;
    return <RecordLoadState title="Purchase request" error={error} onRetry={() => void query.refetch()} onBack={backToList} testID="pr-detail-state" />;
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  const status = chipFor(PR_STATUS, pr.status);
  const own = permissions.userId === pr.requested_by.id;
  const canEdit = isUndecided(pr) && online && (permissions.canApprove || (own && permissions.canRequest));
  const created = formatBranchDateTime(pr.created_at, timeZone) ?? pr.created_at;
  const declineState = actions.decline.state;
  const purchaseOrder = pr.purchase_order;
  const estimateTotal = estimateTotalCents(pr.items);
  const canApproveAll = canDecide && actions.pendingCount > 0;
  const blocked = actions.busy !== null;

  const header = (
    <View style={{ gap: gutter }}>
      {online ? null : <Banner variant="warning" message={PURCHASING_OFFLINE_MESSAGE} testID="pr-detail-offline" />}
      {actions.notice ? <Banner variant="success" message={actions.notice} testID="pr-detail-notice" /> : null}
      {actions.banner ? <Banner message={actions.banner} testID="pr-detail-banner" /> : null}
      <PdfErrorBanner pdf={pdf} testID="pr-detail-pdf-error" />
      {own && permissions.canApprove && online && !permissions.canApproveOwn && actions.pendingCount > 0 ? (
        <Banner variant="info" message={`This is your request. ${SELF_APPROVAL_MESSAGE}`} testID="pr-detail-own" />
      ) : null}

      <RecordHeaderCard
        title={pr.pr_no}
        meta={`Created ${created}`}
        chips={<Chip label={status.label} variant={status.variant} testID="pr-detail-status" />}
        testID="pr-detail-summary"
      >
        <View style={styles.details}>
          <View style={styles.detail}>
            <DetailRow label="Requested by" value={pr.requested_by.name} testID="pr-detail-requested" />
          </View>
          <View style={styles.detail}>
            <DetailRow label="Date needed" value={pr.date_needed ? formatBusinessDate(pr.date_needed) : 'Not set'} testID="pr-detail-needed" />
          </View>
          {purchaseOrder ? (
            <View style={[styles.detail, styles.withAction]}>
              <View style={styles.flex}>
                <DetailRow label="Purchase order" value={`${purchaseOrder.po_no} · ${chipFor(PO_STATUS, purchaseOrder.status).label}`} testID="pr-detail-po" />
              </View>
              <View style={styles.poActions}>
                <Button title="Open" leftIcon="open-outline" variant="secondary" onPress={() => router.push(purchaseOrderRoute(purchaseOrder.ulid))} testID="pr-detail-open-po" />
                <PdfButton pdf={pdf} target={{ kind: 'po', ulid: purchaseOrder.ulid }} accessibilityLabel={`PDF of ${purchaseOrder.po_no}`} testID="pr-detail-po-pdf" />
              </View>
            </View>
          ) : null}
        </View>
        {pr.remarks ? <DetailRow label="Remarks" value={pr.remarks} testID="pr-detail-remarks" /> : null}
        {canApproveAll || canEdit ? (
          <View style={styles.actions} testID="pr-detail-actions">
            {canApproveAll ? (
              <Button
                title={`Approve all remaining (${actions.pendingCount})`}
                leftIcon="checkmark-done-outline"
                onPress={actions.approveAll.open}
                disabled={blocked}
                style={styles.action}
                testID="pr-detail-approve-all"
              />
            ) : null}
            {canEdit ? (
              <Button
                title="Edit"
                leftIcon="create-outline"
                variant="secondary"
                onPress={() => router.push(editPurchaseRequestRoute(pr.ulid))}
                disabled={blocked}
                style={styles.action}
                testID="pr-detail-edit"
              />
            ) : null}
            {canEdit ? (
              <Button
                title="Cancel request"
                leftIcon="close-circle-outline"
                variant="danger"
                onPress={actions.cancelRequest.open}
                disabled={blocked}
                style={styles.action}
                testID="pr-detail-cancel"
              />
            ) : null}
          </View>
        ) : null}
      </RecordHeaderCard>

      <View style={styles.itemsTitle} testID="pr-detail-items-header">
        <SectionLabel>Items</SectionLabel>
        <Text style={styles.muted}>{`${pr.items.length} ${pr.items.length === 1 ? 'item' : 'items'}`}</Text>
      </View>
    </View>
  );

  const footer = (
    <View style={{ paddingTop: gutter }}>
      <DetailColumns
        main={<TimelineCard entries={pr.timeline ?? []} timeZone={timeZone} testID="pr-detail-timeline" />}
        aside={
          <SummaryCard
            title="Summary"
            note="Only people who can approve purchases decide items. Once every item is decided, the approved ones become one purchase order."
            testID="pr-detail-totals"
          >
            <SummaryLine label="Approved so far" value={decisionTotal(pr, 'approved')} testID="pr-detail-totals-approved" />
            <SummaryLine label="Waiting for decision" value={decisionTotal(pr, 'pending')} testID="pr-detail-totals-pending" />
            <SummaryLine label="Declined" value={decisionTotal(pr, 'declined')} testID="pr-detail-totals-declined" />
            <SummaryDivider />
            <SummaryLine
              label="Estimated total"
              value={estimateTotal === null ? 'Not every item has a price' : formatPeso(estimateTotal)}
              strong
              testID="pr-detail-totals-estimate"
            />
          </SummaryCard>
        }
      />
    </View>
  );

  return (
    <Screen edges={[]} testID="pr-detail-screen">
      <TopBar
        title={pr.pr_no}
        subtitle={status.label}
        left={<IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back" onPress={backToList} testID="pr-detail-back" />}
        right={<PdfButton pdf={pdf} target={{ kind: 'pr', ulid: pr.ulid, pr }} accessibilityLabel={`PDF of ${pr.pr_no}`} testID="pr-detail-pdf" />}
        testID="pr-detail-header"
      />
      <SafeAreaView edges={['left', 'right']} style={styles.fill}>
        <DataTable
          columns={columns}
          rows={pr.items}
          keyExtractor={itemKey}
          rowTestID={itemTestID}
          rowAccessibilityLabel={itemAccessibilityLabel}
          rowAccessible={false}
          renderCard={renderCard}
          cardsInPortrait
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
          testID="pr-detail-scroll"
        />
      </SafeAreaView>

      <ConfirmDialog
        visible={declineState !== null}
        title="Decline item?"
        message={declineState ? `“${declineState.name}” won't be ordered.` : undefined}
        confirmLabel="Decline"
        confirmVariant="danger"
        icon="close-circle-outline"
        busy={actions.busy !== null && actions.busy.startsWith('decline')}
        onConfirm={actions.decline.submit}
        onCancel={actions.decline.cancel}
        testID="pr-decline-dialog"
      >
        <Input
          label="Reason"
          value={declineState?.reason ?? ''}
          onChangeText={actions.decline.setReason}
          placeholder="e.g. We still have enough"
          maxLength={DECISION_REASON_MAX}
          error={declineState?.error}
          editable={actions.busy === null}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (actions.busy === null) actions.decline.submit();
          }}
          testID="pr-decline-reason"
        />
      </ConfirmDialog>
      <ConfirmDialog
        visible={actions.approveAll.visible}
        title="Approve all remaining?"
        message={`${actions.pendingCount} pending ${actions.pendingCount === 1 ? 'item is' : 'items are'} approved. When the last item is decided, the purchase order is created.`}
        confirmLabel="Approve all"
        icon="checkmark-done-outline"
        busy={actions.busy === 'approve-all'}
        onConfirm={actions.approveAll.confirm}
        onCancel={actions.approveAll.cancel}
        testID="pr-approve-all-dialog"
      />
      <ConfirmDialog
        visible={actions.cancelRequest.visible}
        title="Cancel this request?"
        message={`${pr.pr_no} is kept as Cancelled and can't be approved.`}
        confirmLabel="Cancel request"
        cancelLabel="Keep"
        confirmVariant="danger"
        icon="close-circle-outline"
        busy={actions.busy === 'cancel'}
        onConfirm={actions.cancelRequest.confirm}
        onCancel={actions.cancelRequest.cancel}
        testID="pr-cancel-dialog"
      />
      <PurchasePdfSheet pdf={pdf} testID="pr-pdf-sheet" />
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
  poActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemsTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  item: {
    gap: spacing.sm,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  itemName: {
    ...typography.heading,
    color: colors.text,
  },
  qty: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  decision: {
    alignItems: 'flex-start',
    gap: spacing.xs,
    maxWidth: '100%',
  },
  decide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  decideButton: {
    flexGrow: 1,
  },
  resting: {
    color: colors.textResting,
  },
  muted: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  body: {
    ...typography.bodySm,
    color: colors.text,
  },
  reason: {
    ...typography.caption,
    color: colors.dangerText,
  },
});
