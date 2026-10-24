import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { decisionSummary, estimateTotalCents, itemNames, PurchaseRequestCard } from '@/components/purchasing/PurchaseRequestCard';
import { chipFor, PO_STATUS, PR_STATUS, PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { CardGrid, type GridEmptyProps, type GridTable } from '@/components/shared/CardGrid';
import { ChipFilterRow } from '@/components/shared/ChipFilterRow';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { ActionMenu, type MenuAction } from '@/components/ui/ActionMenu';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { CellText } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { purchaseOrderRoute, purchaseRequestRoute, ROUTES } from '@/constants/routes';
import { spacing } from '@/constants/theme';
import { usePurchaseRequestListScreen, type PurchaseRequestView } from '@/hooks/purchasing/usePurchaseRequests';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import type { PurchaseRequest, PurchaseRequestStatus } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { formatBusinessDate } from '@/utils/dates';

const STATUS_OPTIONS: readonly { value: PurchaseRequestStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  ...(Object.keys(PR_STATUS) as PurchaseRequestStatus[]).map((status) => ({ value: status, label: PR_STATUS[status].label })),
];

function keyOf(pr: PurchaseRequest): string {
  return pr.ulid;
}

function openRequest(pr: PurchaseRequest) {
  router.push(purchaseRequestRoute(pr.ulid));
}

function openNew() {
  router.push(ROUTES.newPurchaseRequest);
}

function rowTestID(pr: PurchaseRequest): string {
  return `pr-card-${pr.ulid}`;
}

function itemsCount(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/** The table (tablets in landscape): number and status, who and the estimate, the items, the decisions, when needed, its PO. */
/** The row menu of a PR that has a PO: Open, and Open its purchase order. */
function prActions(pr: PurchaseRequest): MenuAction[] {
  const actions: MenuAction[] = [{ key: 'open', label: 'Open', icon: 'open-outline', onPress: () => openRequest(pr) }];
  const po = pr.purchase_order;
  if (po) actions.push({ key: 'po', label: `Open ${po.po_no}`, icon: 'clipboard-outline', onPress: () => router.push(purchaseOrderRoute(po.ulid)) });
  return actions;
}

function usePurchaseRequestTable(timeZone: string, onMenu: (pr: PurchaseRequest) => void): GridTable<PurchaseRequest> {
  return useMemo(
    () => ({
      columns: [
        {
          key: 'pr',
          header: 'Request',
          flex: 1.3,
          render: (pr) => {
            const status = chipFor(PR_STATUS, pr.status);
            return (
              <View style={styles.cellStack}>
                <CellText variant="strong">{pr.pr_no}</CellText>
                <Chip label={status.label} variant={status.variant} testID={`${rowTestID(pr)}-status`} />
              </View>
            );
          },
        },
        {
          key: 'meta',
          header: 'Requested by',
          flex: 1.3,
          render: (pr) => {
            const estimate = pr.items.length > 0 ? estimateTotalCents(pr.items) : null;
            const meta = [pr.requested_by.name, itemsCount(pr.items.length)];
            if (estimate !== null) meta.push(`Est. ${formatPeso(estimate)}`);
            return (
              <CellText numberOfLines={2} testID={`${rowTestID(pr)}-meta`}>
                {meta.join(' · ')}
              </CellText>
            );
          },
        },
        {
          key: 'items',
          header: 'Items',
          flex: 1.6,
          render: (pr) => (
            <CellText numberOfLines={2} testID={`${rowTestID(pr)}-items`}>
              {itemNames(pr.items.map((item) => item.item.name))}
              {` · ${itemNames([...new Set(pr.items.map((item) => item.supplier.name))])}`}
            </CellText>
          ),
        },
        {
          key: 'decisions',
          header: 'Decisions',
          render: (pr) => (
            <View style={styles.cellStack}>
              <CellText variant="muted" numberOfLines={2} testID={`${rowTestID(pr)}-decisions`}>
                {decisionSummary(pr)}
              </CellText>
              <CellText variant="muted">{pr.date_needed ? `Needed ${formatBusinessDate(pr.date_needed)}` : (formatBranchDateTime(pr.created_at, timeZone) ?? pr.created_at)}</CellText>
            </View>
          ),
        },
        {
          key: 'po',
          header: 'Purchase order',
          render: (pr) => {
            const po = pr.purchase_order ? chipFor(PO_STATUS, pr.purchase_order.status) : null;
            return pr.purchase_order && po ? (
              <View style={styles.cellStack}>
                <Chip label={pr.purchase_order.po_no} variant="primary" testID={`${rowTestID(pr)}-po`} />
                <Chip label={po.label} variant={po.variant} />
              </View>
            ) : (
              <CellText variant="muted">—</CellText>
            );
          },
        },
      ],
      onRowPress: openRequest,
      rowAccessibilityLabel: (pr) => `${pr.pr_no}, ${chipFor(PR_STATUS, pr.status).label}, ${itemsCount(pr.items.length)}, by ${pr.requested_by.name}`,
      rowAccessibilityHint: 'Opens the purchase request',
      rowTestID,
      // ⋯ only on a request with a purchase order (otherwise the row's tap is the only action).
      rowActions: (pr: PurchaseRequest) =>
        pr.purchase_order ? (
          <IconButton
            icon="ellipsis-horizontal"
            variant="ghost"
            accessibilityLabel={`Actions for ${pr.pr_no}`}
            onPress={() => onMenu(pr)}
            testID={`${rowTestID(pr)}-actions`}
          />
        ) : null,
    }),
    [timeZone, onMenu],
  );
}

/**
 * Purchase requests (§L): the `All · Needs my decision · Mine` switch (Needs
 * my decision with `purchase.approve`), the status chips and the search (PR
 * number or item name) in a white card over the band, then the table in
 * landscape and the cards in portrait (MASTER §6), newest first, with every
 * list state and the "Showing n" footer. "+" with `purchase.request`. Offline: `Purchasing needs a connection.`
 */
export function PurchaseRequestListScreen() {
  const screen = usePurchaseRequestListScreen();
  const { canRequest } = usePurchasingPermissions();
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const [menuPr, setMenuPr] = useState<PurchaseRequest | null>(null);
  const table = usePurchaseRequestTable(timeZone, setMenuPr);

  const views: SegmentOption<PurchaseRequestView>[] = [
    { value: 'all', label: 'All', testID: 'pr-view-all' },
    ...(screen.showDecisionView ? [{ value: 'decision' as const, label: 'Needs my decision', testID: 'pr-view-decision' }] : []),
    { value: 'mine', label: 'Mine', testID: 'pr-view-mine' },
  ];

  let empty: GridEmptyProps;
  if (screen.view === 'decision' && screen.status === 'all' && !screen.searching) {
    empty = { title: 'Nothing waiting on you', message: 'Requests that need your decision show here.', icon: 'checkmark-done-outline', actionLabel: 'Show all', onAction: screen.clearFilters };
  } else if (screen.filtersActive) {
    empty = { title: 'No matching requests', message: 'Try another number, item or status.', icon: 'search-outline', actionLabel: 'Clear filters', onAction: screen.clearFilters };
  } else if (canRequest) {
    empty = { title: 'No purchase requests yet', message: 'Ask for ingredients or stock from your suppliers.', icon: 'document-text-outline', actionLabel: 'New request', onAction: openNew };
  } else {
    empty = { title: 'No purchase requests yet', message: 'Requests from the team show here.', icon: 'document-text-outline' };
  }

  return (
    <Screen edges={[]} testID="pr-list-screen">
      <ListHeader
        band
        title="Purchase requests"
        newLabel="New purchase request"
        newTitle="New request"
        onNew={canRequest && screen.online ? openNew : undefined}
        testIDPrefix="prs"
      />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="prs-toolbar">
          <ListFilters<PurchaseRequestView>
            search={screen.search}
            onSearchChange={screen.setSearch}
            searching={screen.searching}
            placeholder="PR number or item"
            searchTestID="pr-search"
            segment={{ options: views, value: screen.view, onChange: screen.setView, accessibilityLabel: 'Which requests', testID: 'pr-view' }}
          />
          <ChipFilterRow options={STATUS_OPTIONS} value={screen.status} onChange={screen.setStatus} accessibilityLabel="Status" testIDPrefix="pr-status" />
        </ListToolbar>
        {screen.online ? (
          <CardGrid
            items={screen.list.items}
            keyOf={keyOf}
            renderItem={(pr) => <PurchaseRequestCard pr={pr} timeZone={timeZone} onPress={openRequest} />}
            {...screen.list.grid}
            empty={empty}
            table={table}
            testID="prs-grid"
          />
        ) : (
          <EmptyState title={PURCHASING_OFFLINE_MESSAGE} message="Requests load from the server. Connect this tablet and try again." icon="cloud-offline-outline" testID="prs-offline" />
        )}
      </SafeAreaView>
      <ActionMenu title={menuPr ? menuPr.pr_no : null} actions={menuPr ? prActions(menuPr) : []} onClose={() => setMenuPr(null)} testID="pr-actions" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  cellStack: {
    gap: spacing.xs,
    alignItems: 'flex-start',
    maxWidth: '100%',
  },
});
