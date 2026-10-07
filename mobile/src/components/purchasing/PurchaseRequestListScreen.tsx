import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PurchaseRequestCard } from '@/components/purchasing/PurchaseRequestCard';
import { PR_STATUS, PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { CardGrid, type GridEmptyProps } from '@/components/shared/CardGrid';
import { ChipFilterRow } from '@/components/shared/ChipFilterRow';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { purchaseRequestRoute, ROUTES } from '@/constants/routes';
import { usePurchaseRequestListScreen, type PurchaseRequestView } from '@/hooks/purchasing/usePurchaseRequests';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import type { PurchaseRequest, PurchaseRequestStatus } from '@/services/types';
import { useSessionStore } from '@/stores/session';

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

/**
 * Purchase requests (§L): the `All · Needs my decision · Mine` switch (Needs
 * my decision with `purchase.approve`), the status chips, the search (PR
 * number or item name), and the card grid, newest first, with every list
 * state. "+" with `purchase.request`. Offline: `Purchasing needs a connection.`
 */
export function PurchaseRequestListScreen() {
  const screen = usePurchaseRequestListScreen();
  const { canRequest } = usePurchasingPermissions();
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');

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
        title="Purchase requests"
        newLabel="New purchase request"
        newTitle="New request"
        onNew={canRequest && screen.online ? openNew : undefined}
        testIDPrefix="prs"
      />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListFilters<PurchaseRequestView>
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="PR number or item"
          searchTestID="pr-search"
          segment={{ options: views, value: screen.view, onChange: screen.setView, accessibilityLabel: 'Which requests', testID: 'pr-view' }}
        />
        <ChipFilterRow options={STATUS_OPTIONS} value={screen.status} onChange={screen.setStatus} accessibilityLabel="Status" testIDPrefix="pr-status" />
        {screen.online ? (
          <CardGrid
            items={screen.list.items}
            keyOf={keyOf}
            renderItem={(pr) => <PurchaseRequestCard pr={pr} timeZone={timeZone} onPress={openRequest} />}
            {...screen.list.grid}
            empty={empty}
            testID="prs-grid"
          />
        ) : (
          <EmptyState title={PURCHASING_OFFLINE_MESSAGE} message="Requests load from the server. Connect this tablet and try again." icon="cloud-offline-outline" testID="prs-offline" />
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
