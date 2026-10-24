import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PurchaseOrderCard } from '@/components/purchasing/PurchaseOrderCard';
import { itemNames } from '@/components/purchasing/PurchaseRequestCard';
import { chipFor, PO_RECEIVING_STATUS, PO_STATUS, PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { CardGrid, type GridEmptyProps, type GridTable } from '@/components/shared/CardGrid';
import { ChipFilterRow } from '@/components/shared/ChipFilterRow';
import { ListFilters, ListSearch } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { ActionMenu, type MenuAction } from '@/components/ui/ActionMenu';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { CellText } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { purchaseOrderRoute, receiveRoute } from '@/constants/routes';
import { colors, spacing } from '@/constants/theme';
import { usePurchaseOrderListScreen } from '@/hooks/purchasing/usePurchaseOrders';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { useResponsive } from '@/hooks/useResponsive';
import type { PurchaseOrder, PurchaseOrderReceivingStatus, PurchaseOrderStatus } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatBusinessDate } from '@/utils/dates';

const STATUS_OPTIONS: readonly { value: PurchaseOrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  ...(Object.keys(PO_STATUS) as PurchaseOrderStatus[]).map((status) => ({ value: status, label: PO_STATUS[status].label })),
];

const RECEIVING_OPTIONS: readonly { value: PurchaseOrderReceivingStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Any receiving' },
  ...(Object.keys(PO_RECEIVING_STATUS) as PurchaseOrderReceivingStatus[]).map((status) => ({ value: status, label: PO_RECEIVING_STATUS[status].label })),
];

function keyOf(po: PurchaseOrder): string {
  return po.ulid;
}

function openOrder(po: PurchaseOrder) {
  router.push(purchaseOrderRoute(po.ulid));
}

function openReceive(po: PurchaseOrder) {
  router.push(receiveRoute(po.ulid));
}

function rowTestID(po: PurchaseOrder): string {
  return `po-card-${po.ulid}`;
}

/** The table (tablets in landscape): number, status (and receiving), PR and delivery, lines, suppliers, total. Test IDs match the card's. */
/** The row menu of a PO: Open, and Receive where the detail would offer it (approved, not fully received, `purchase.receive`, online). */
function poActions(po: PurchaseOrder, canReceive: boolean): MenuAction[] {
  const actions: MenuAction[] = [{ key: 'open', label: 'Open', icon: 'open-outline', onPress: () => openOrder(po) }];
  if (canReceive && po.status === 'approved' && po.receiving_status !== 'fully_received') {
    actions.push({ key: 'receive', label: 'Receive', icon: 'download-outline', onPress: () => openReceive(po) });
  }
  return actions;
}

function usePurchaseOrderTable(receiving: boolean, onMenu: ((po: PurchaseOrder) => void) | null): GridTable<PurchaseOrder> {
  return useMemo(
    () => ({
      columns: [
        { key: 'po', header: 'Order', flex: 1.1, render: (po) => <CellText variant="strong">{po.po_no}</CellText> },
        {
          key: 'status',
          header: 'Status',
          flex: 1.2,
          render: (po) => {
            const status = chipFor(PO_STATUS, po.status);
            const receivingChip = chipFor(PO_RECEIVING_STATUS, po.receiving_status);
            return (
              <View style={styles.cellStack}>
                <Chip label={status.label} variant={status.variant} testID={`${rowTestID(po)}-status`} />
                {po.status === 'approved' ? <Chip label={receivingChip.label} variant={receivingChip.variant} testID={`${rowTestID(po)}-receiving`} /> : null}
              </View>
            );
          },
        },
        {
          key: 'from',
          header: 'From',
          flex: 1.2,
          render: (po) => (
            <View style={styles.cellStack}>
              <CellText>{po.purchase_request.pr_no}</CellText>
              {po.expected_delivery_date ? <CellText variant="muted">Expected {formatBusinessDate(po.expected_delivery_date)}</CellText> : null}
            </View>
          ),
        },
        {
          key: 'lines',
          header: 'Lines',
          flex: 1.6,
          render: (po) => (
            <View style={styles.cellStack}>
              <CellText numberOfLines={2}>
                {po.lines.length} {po.lines.length === 1 ? 'line' : 'lines'}: {itemNames(po.lines.map((line) => line.item.name))}
              </CellText>
              <CellText variant="muted">{itemNames([...new Set(po.lines.map((line) => line.supplier.name))])}</CellText>
            </View>
          ),
        },
        {
          key: 'total',
          header: 'Total',
          align: 'right',
          render: (po) => (
            <CellText variant="strong" align="right" style={styles.total} testID={`${rowTestID(po)}-total`}>
              {formatPeso(po.total_cents)}
            </CellText>
          ),
        },
      ],
      onRowPress: receiving ? openReceive : openOrder,
      rowAccessibilityLabel: (po) =>
        `${po.po_no}, ${chipFor(PO_STATUS, po.status).label}, ${chipFor(PO_RECEIVING_STATUS, po.receiving_status).label}, total ${formatPeso(po.total_cents)}`,
      rowAccessibilityHint: receiving ? 'Opens the receive screen' : 'Opens the purchase order',
      rowTestID,
      rowActions: onMenu
        ? (po: PurchaseOrder) => (
            <IconButton
              icon="ellipsis-horizontal"
              variant="ghost"
              accessibilityLabel={`Actions for ${po.po_no}`}
              onPress={() => onMenu(po)}
              testID={`${rowTestID(po)}-actions`}
            />
          )
        : undefined,
    }),
    [receiving, onMenu],
  );
}

/**
 * Purchase orders (`orders`: status and receiving chips) and Receiving
 * (`receiving`: the approved POs not fully received, which open the receive
 * screen). On the band; the search (in the header on tablets) and the status
 * chips in a white card; the table in landscape and the cards in portrait
 * (MASTER §6); every list state and the "Showing n" footer. Offline:
 * `Purchasing needs a connection.`
 */
export function PurchaseOrderListScreen({ mode }: { mode: 'orders' | 'receiving' }) {
  const screen = usePurchaseOrderListScreen(mode);
  // Tablets: the search sits in the top bar (Sage "Inventory" pattern); phones keep it under the bar.
  const inlineSearch = useResponsive().isTablet;
  const receiving = mode === 'receiving';
  const { canReceive } = usePurchasingPermissions();
  const [menuPo, setMenuPo] = useState<PurchaseOrder | null>(null);
  // The ⋯ menu only where it offers more than Open (the orders list, with `purchase.receive`, online).
  const table = usePurchaseOrderTable(receiving, !receiving && canReceive && screen.online ? setMenuPo : null);

  const empty: GridEmptyProps = screen.filtersActive
    ? { title: 'No matching orders', message: 'Try another number, supplier or status.', icon: 'search-outline', actionLabel: 'Clear filters', onAction: screen.clearFilters }
    : receiving
      ? { title: 'Nothing to receive', message: 'Approved purchase orders waiting for delivery show here.', icon: 'download-outline' }
      : { title: 'No purchase orders yet', message: 'A purchase order is created when a request is approved.', icon: 'clipboard-outline' };

  return (
    <Screen edges={[]} testID={receiving ? 'receiving-list-screen' : 'po-list-screen'}>
      <ListHeader
        band
        title={receiving ? 'Receiving' : 'Purchase orders'}
        subtitle={receiving ? 'Approved orders to receive' : undefined}
        testIDPrefix={receiving ? 'receiving' : 'pos'}
        search={
          inlineSearch ? (
            <ListSearch
              search={screen.search}
              onSearchChange={screen.setSearch}
              searching={screen.searching}
              placeholder="PO number, supplier or item"
              variant="searchSurface"
              testID="po-search"
            />
          ) : undefined
        }
      />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        {receiving && inlineSearch ? null : (
          <ListToolbar testID={receiving ? 'receiving-toolbar' : 'pos-toolbar'}>
            <ListFilters
              search={screen.search}
              onSearchChange={screen.setSearch}
              searching={screen.searching}
              placeholder="PO number, supplier or item"
              searchTestID="po-search"
              hideSearch={inlineSearch}
            />
            {receiving ? null : (
              <>
                <ChipFilterRow options={STATUS_OPTIONS} value={screen.status} onChange={screen.setStatus} accessibilityLabel="Status" testIDPrefix="po-status" />
                <ChipFilterRow options={RECEIVING_OPTIONS} value={screen.receiving} onChange={screen.setReceiving} accessibilityLabel="Receiving" testIDPrefix="po-receiving" />
              </>
            )}
          </ListToolbar>
        )}
        {screen.online ? (
          <CardGrid
            items={screen.list.items}
            keyOf={keyOf}
            renderItem={(po) => (
              <PurchaseOrderCard
                po={po}
                hint={receiving ? 'Opens the receive screen' : 'Opens the purchase order'}
                onPress={receiving ? openReceive : openOrder}
              />
            )}
            {...screen.list.grid}
            empty={empty}
            table={table}
            testID={receiving ? 'receiving-grid' : 'pos-grid'}
          />
        ) : (
          <EmptyState title={PURCHASING_OFFLINE_MESSAGE} message="Orders load from the server. Connect this tablet and try again." icon="cloud-offline-outline" testID="pos-offline" />
        )}
      </SafeAreaView>
      <ActionMenu
        title={menuPo ? menuPo.po_no : null}
        actions={menuPo ? poActions(menuPo, canReceive && screen.online) : []}
        onClose={() => setMenuPo(null)}
        testID="po-actions"
      />
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
  total: {
    color: colors.green,
  },
});
