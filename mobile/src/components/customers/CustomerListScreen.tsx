import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomerCard } from '@/components/customers/CustomerCard';
import { CardGrid } from '@/components/shared/CardGrid';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
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

/**
 * Customers (any signed-in user may look them up).
 * - Header: back, "Customers", and "+" only with `sale.create`.
 * - Search (300 ms debounce) on names, phone and email.
 * - Card grid: 1 column on phone portrait, 2 on phone landscape / tablet
 *   portrait, 3 on tablet landscape; infinite scroll, pull-to-refresh,
 *   loading / empty / error-with-retry.
 */
export function CustomerListScreen() {
  const screen = useCustomerListScreen();
  const canCreate = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));

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
        title="Customers"
        newLabel="New customer"
        onNew={canCreate ? openNewCustomer : undefined}
        testIDPrefix="customers"
      />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListFilters
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="Name, phone or email"
          searchTestID="customer-search"
        />
        <CardGrid
          items={screen.list.items}
          keyOf={customerKey}
          renderItem={(customer) => <CustomerCard customer={customer} onPress={openCustomer} />}
          {...screen.list.grid}
          empty={empty}
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
