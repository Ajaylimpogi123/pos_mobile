import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { CardGrid, type GridEmptyProps } from '@/components/shared/CardGrid';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { SupplierCard } from '@/components/suppliers/SupplierCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { ROUTES, supplierRoute } from '@/constants/routes';
import { useCanManageSuppliers, useSupplierListScreen, type SupplierSegment } from '@/hooks/suppliers/useSuppliers';
import type { Supplier } from '@/services/types';

const SEGMENTS: readonly SegmentOption<SupplierSegment>[] = [
  { value: 'all', label: 'All', testID: 'suppliers-segment-all' },
  { value: 'active', label: 'Active', testID: 'suppliers-segment-active' },
  { value: 'inactive', label: 'Inactive', testID: 'suppliers-segment-inactive' },
];

function keyOf(supplier: Supplier): string {
  return String(supplier.id);
}

function openSupplier(supplier: Supplier) {
  router.push(supplierRoute(supplier.id));
}

function openNew() {
  router.push(ROUTES.newSupplier);
}

/**
 * Suppliers (Purchasing; any purchase permission reads, `supplier.manage`
 * creates and edits): the card grid with a search (name or contact) and an
 * active filter, every list state. Offline: `Purchasing needs a connection.`
 */
export function SupplierListScreen() {
  const screen = useSupplierListScreen();
  const canManage = useCanManageSuppliers();

  let empty: GridEmptyProps;
  if (screen.filtersActive) {
    empty = { title: 'No matching suppliers', message: 'Try a name or a contact.', icon: 'search-outline', actionLabel: 'Clear filters', onAction: screen.clearFilters };
  } else if (canManage) {
    empty = { title: 'No suppliers yet', message: 'Add who you buy from, then request items from them.', icon: 'business-outline', actionLabel: 'New supplier', onAction: openNew };
  } else {
    empty = { title: 'No suppliers yet', message: 'Suppliers added by a manager show here.', icon: 'business-outline' };
  }

  return (
    <Screen edges={[]} testID="supplier-list-screen">
      <ListHeader title="Suppliers" newLabel="New supplier" onNew={canManage && screen.online ? openNew : undefined} testIDPrefix="suppliers" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListFilters<SupplierSegment>
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="Name or contact"
          searchTestID="supplier-search"
          segment={{ options: SEGMENTS, value: screen.segment, onChange: screen.setSegment, accessibilityLabel: 'Active filter', testID: 'suppliers-segment' }}
        />
        {screen.online ? (
          <CardGrid
            items={screen.list.items}
            keyOf={keyOf}
            renderItem={(supplier) => <SupplierCard supplier={supplier} onPress={openSupplier} />}
            {...screen.list.grid}
            empty={empty}
            testID="suppliers-grid"
          />
        ) : (
          <EmptyState title={PURCHASING_OFFLINE_MESSAGE} message="Suppliers load from the server. Connect this tablet and try again." icon="cloud-offline-outline" testID="suppliers-offline" />
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
