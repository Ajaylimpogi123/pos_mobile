import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PurchaseOrderCard } from '@/components/purchasing/PurchaseOrderCard';
import { PO_RECEIVING_STATUS, PO_STATUS, PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { CardGrid, type GridEmptyProps } from '@/components/shared/CardGrid';
import { ChipFilterRow } from '@/components/shared/ChipFilterRow';
import { ListFilters, ListSearch } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { purchaseOrderRoute, receiveRoute } from '@/constants/routes';
import { usePurchaseOrderListScreen } from '@/hooks/purchasing/usePurchaseOrders';
import { useResponsive } from '@/hooks/useResponsive';
import type { PurchaseOrder, PurchaseOrderReceivingStatus, PurchaseOrderStatus } from '@/services/types';

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

/**
 * Purchase orders (`orders`: status and receiving chips) and Receiving
 * (`receiving`: the approved POs not fully received, which open the receive
 * screen). A search, the card grid, every list state. Offline:
 * `Purchasing needs a connection.`
 */
export function PurchaseOrderListScreen({ mode }: { mode: 'orders' | 'receiving' }) {
  const screen = usePurchaseOrderListScreen(mode);
  // Tablets: the search sits in the top bar (Sage "Inventory" pattern); phones keep it under the bar.
  const inlineSearch = useResponsive().isTablet;
  const receiving = mode === 'receiving';

  const empty: GridEmptyProps = screen.filtersActive
    ? { title: 'No matching orders', message: 'Try another number, supplier or status.', icon: 'search-outline', actionLabel: 'Clear filters', onAction: screen.clearFilters }
    : receiving
      ? { title: 'Nothing to receive', message: 'Approved purchase orders waiting for delivery show here.', icon: 'download-outline' }
      : { title: 'No purchase orders yet', message: 'A purchase order is created when a request is approved.', icon: 'clipboard-outline' };

  return (
    <Screen edges={[]} testID={receiving ? 'receiving-list-screen' : 'po-list-screen'}>
      <ListHeader
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
            testID={receiving ? 'receiving-grid' : 'pos-grid'}
          />
        ) : (
          <EmptyState title={PURCHASING_OFFLINE_MESSAGE} message="Orders load from the server. Connect this tablet and try again." icon="cloud-offline-outline" testID="pos-offline" />
        )}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
});
