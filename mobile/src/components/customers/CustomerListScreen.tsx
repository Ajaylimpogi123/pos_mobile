import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomerCard } from '@/components/customers/CustomerCard';
import { CardGrid, type GridTable } from '@/components/shared/CardGrid';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { CellText } from '@/components/ui/DataTable';
import { Screen } from '@/components/ui/Screen';
import { customerRoute, ROUTES } from '@/constants/routes';
import { useCustomerListScreen } from '@/hooks/customers/useCustomers';
import type { Customer } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

function openCustomer(customer: Customer) {
  router.push(customerRoute(customer.id));
}

function customerKey(customer: Customer): string {
  return String(customer.id);
}

function openNewCustomer() {
  router.push(ROUTES.newCustomer);
}

function rowTestID(customer: Customer): string {
  return `customer-card-${customer.id}`;
}

/** The table (tablets in landscape): name, contact, email and a notes preview. Row and cell test IDs match the card's. */
function useCustomerTable(): GridTable<Customer> {
  return useMemo(
    () => ({
      columns: [
        { key: 'name', header: 'Name', flex: 1.4, render: (customer) => <CellText variant="strong">{customer.full_name}</CellText> },
        {
          key: 'contact',
          header: 'Contact',
          render: (customer) =>
            !customer.contact && !customer.email && !customer.notes ? (
              <CellText variant="muted">No contact details</CellText>
            ) : (
              <CellText testID={customer.contact ? `${rowTestID(customer)}-contact` : undefined}>{customer.contact ?? '—'}</CellText>
            ),
        },
        {
          key: 'email',
          header: 'Email',
          flex: 1.3,
          render: (customer) => <CellText testID={customer.email ? `${rowTestID(customer)}-email` : undefined}>{customer.email ?? '—'}</CellText>,
        },
        {
          key: 'notes',
          header: 'Notes',
          flex: 1.5,
          render: (customer) => (
            <CellText variant="muted" numberOfLines={2} testID={customer.notes ? `${rowTestID(customer)}-notes` : undefined}>
              {customer.notes ?? '—'}
            </CellText>
          ),
        },
      ],
      onRowPress: openCustomer,
      rowAccessibilityLabel: (customer) => [customer.full_name, customer.contact, customer.email].filter(Boolean).join(', '),
      rowAccessibilityHint: 'Opens the customer',
      rowTestID,
    }),
    [],
  );
}

/**
 * Customers (any signed-in user may look them up).
 * - Header: back, "Customers", and "+" only with `sale.create`.
 * - Search (300 ms debounce) on names, phone and email.
 * - MASTER §6 / back-office.md: the band (title, branch and business date,
 *   the Add pill), the search in a white card over it, then the table on
 *   tablets in landscape and the cards in portrait and on phones; "Showing n"
 *   and Load more, infinite scroll, pull-to-refresh, loading / empty / error-with-retry.
 */
export function CustomerListScreen() {
  const screen = useCustomerListScreen();
  const canCreate = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));
  const table = useCustomerTable();

  let empty;
  if (screen.filtersActive) {
    empty = {
      title: 'No matching customers',
      message: 'Try a name, a phone number or an email address.',
      icon: 'search-outline' as const,
      actionLabel: 'Clear search',
      onAction: screen.clearSearch,
    };
  } else if (canCreate) {
    empty = {
      title: 'No customers yet',
      message: 'Save regulars here to attach them to their orders.',
      icon: 'people-outline' as const,
      actionLabel: 'New customer',
      onAction: openNewCustomer,
    };
  } else {
    empty = { title: 'No customers yet', message: 'Customers added at the counter will show here.', icon: 'people-outline' as const };
  }

  return (
    <Screen edges={[]} testID="customer-list-screen">
      <ListHeader
        band
        title="Customers"
        newLabel="New customer"
        onNew={canCreate ? openNewCustomer : undefined}
        testIDPrefix="customers"
      />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="customers-toolbar">
          <ListFilters
            search={screen.search}
            onSearchChange={screen.setSearch}
            searching={screen.searching}
            placeholder="Name, phone or email"
            searchTestID="customer-search"
          />
        </ListToolbar>
        <CardGrid
          items={screen.list.items}
          keyOf={customerKey}
          renderItem={(customer) => <CustomerCard customer={customer} onPress={openCustomer} />}
          {...screen.list.grid}
          empty={empty}
          table={table}
          testID="customers-grid"
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
});
