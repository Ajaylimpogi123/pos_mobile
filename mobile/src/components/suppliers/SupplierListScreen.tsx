import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { CardGrid, type GridEmptyProps, type GridTable } from '@/components/shared/CardGrid';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { Chip } from '@/components/ui/Chip';
import { CellText } from '@/components/ui/DataTable';
import { SupplierCard } from '@/components/suppliers/SupplierCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { ROUTES, supplierRoute } from '@/constants/routes';
import { useCanManageSuppliers, useSupplierListScreen, type SupplierSegment } from '@/hooks/suppliers/useSuppliers';
import { spacing } from '@/constants/theme';
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

function rowTestID(supplier: Supplier): string {
  return `supplier-card-${supplier.id}`;
}

/** The table (tablets in landscape): name (and Inactive), contact person, number, email. Test IDs match the card's. */
function useSupplierTable(): GridTable<Supplier> {
  return useMemo(
    () => ({
      columns: [
        {
          key: 'name',
          header: 'Supplier',
          flex: 1.5,
          render: (supplier) => (
            <View style={styles.nameCell}>
              <CellText variant="strong">{supplier.name}</CellText>
              {supplier.is_active ? null : <Chip label="Inactive" variant="neutral" testID={`${rowTestID(supplier)}-inactive`} />}
            </View>
          ),
        },
        {
          key: 'person',
          header: 'Contact person',
          render: (supplier) =>
            supplier.contact_person ? <CellText testID={`${rowTestID(supplier)}-person`}>{supplier.contact_person}</CellText> : <CellText variant="muted">—</CellText>,
        },
        {
          key: 'number',
          header: 'Number',
          render: (supplier) =>
            supplier.contact_number ? <CellText testID={`${rowTestID(supplier)}-number`}>{supplier.contact_number}</CellText> : <CellText variant="muted">—</CellText>,
        },
        {
          key: 'email',
          header: 'Email',
          flex: 1.3,
          render: (supplier) =>
            supplier.email ? <CellText testID={`${rowTestID(supplier)}-email`}>{supplier.email}</CellText> : <CellText variant="muted">—</CellText>,
        },
      ],
      onRowPress: openSupplier,
      rowAccessibilityLabel: (supplier) =>
        [supplier.name, supplier.is_active ? null : 'inactive', supplier.contact_person, supplier.contact_number].filter(Boolean).join(', '),
      rowAccessibilityHint: 'Opens the supplier',
      rowTestID,
    }),
    [],
  );
}

/**
 * Suppliers (Purchasing; any purchase permission reads, `supplier.manage`
 * creates and edits): on the band (with the Add pill), the search and the
 * active filter in a white card, then the table in landscape and the cards in
 * portrait (MASTER §6), every list state and the "Showing n" footer. Offline: `Purchasing needs a connection.`
 */
export function SupplierListScreen() {
  const screen = useSupplierListScreen();
  const canManage = useCanManageSuppliers();
  const table = useSupplierTable();

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
      <ListHeader band title="Suppliers" newLabel="New supplier" onNew={canManage && screen.online ? openNew : undefined} testIDPrefix="suppliers" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="suppliers-toolbar">
          <ListFilters<SupplierSegment>
            search={screen.search}
            onSearchChange={screen.setSearch}
            searching={screen.searching}
            placeholder="Name or contact"
            searchTestID="supplier-search"
            segment={{ options: SEGMENTS, value: screen.segment, onChange: screen.setSegment, accessibilityLabel: 'Active filter', testID: 'suppliers-segment' }}
          />
        </ListToolbar>
        {screen.online ? (
          <CardGrid
            items={screen.list.items}
            keyOf={keyOf}
            renderItem={(supplier) => <SupplierCard supplier={supplier} onPress={openSupplier} />}
            {...screen.list.grid}
            empty={empty}
            table={table}
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
  nameCell: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
