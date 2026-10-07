import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StaffCard } from '@/components/staff/StaffCard';
import { CardGrid } from '@/components/shared/CardGrid';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { Screen } from '@/components/ui/Screen';
import { ROUTES, staffRoute } from '@/constants/routes';
import type { StaffStatusFilter } from '@/hooks/staff/queryKeys';
import { useStaffListScreen } from '@/hooks/staff/useStaffListScreen';
import type { StaffUser } from '@/services/types';
import { useSessionStore } from '@/stores/session';

const STATUS: readonly SegmentOption<StaffStatusFilter>[] = [
  { value: 'active', label: 'Active', testID: 'staff-status-active' },
  { value: 'inactive', label: 'Inactive', testID: 'staff-status-inactive' },
  { value: 'all', label: 'All', testID: 'staff-status-all' },
];

function openStaff(user: StaffUser) {
  router.push(staffRoute(user.id));
}

function staffKey(user: StaffUser): string {
  return String(user.id);
}

function openNewStaff() {
  router.push(ROUTES.newStaff);
}

/**
 * Staff list (permission `user.manage`).
 * - Header: back, "Staff", "+" (new staff).
 * - Filters above the list (so they survive loading/empty states and
 *   rotation): search (300 ms debounce), Active / Inactive / All, role chips.
 * - Card grid: 1 column on phone portrait, 2 on phone landscape / tablet
 *   portrait, 3 on tablet landscape; infinite scroll, pull-to-refresh,
 *   loading / empty / error-with-retry (a 403 shows "No access").
 */
export function StaffListScreen() {
  const screen = useStaffListScreen();
  const selfId = useSessionStore((state) => state.user?.id ?? null);
  const roleChips = useMemo(() => screen.roles.map((role) => ({ id: role.id, label: role.name })), [screen.roles]);

  return (
    <Screen edges={[]} testID="staff-list-screen">
      <ListHeader title="Staff" newLabel="New staff" onNew={openNewStaff} testIDPrefix="staff" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListFilters
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="Name or email"
          searchTestID="staff-search"
          segment={{
            options: STATUS,
            value: screen.status,
            onChange: screen.setStatus,
            accessibilityLabel: 'Status',
            testID: 'staff-status-filter',
          }}
          chips={{
            items: roleChips,
            selectedId: screen.roleId,
            onChange: screen.setRoleId,
            allLabel: 'All roles',
            testIDPrefix: 'role-chip',
          }}
        />
        <CardGrid
          items={screen.list.items}
          keyOf={staffKey}
          renderItem={(user) => <StaffCard user={user} isSelf={user.id === selfId} onPress={openStaff} />}
          {...screen.list.grid}
          empty={
            screen.filtersActive
              ? {
                  title: 'No matching staff',
                  message: 'Try another search, or clear the filters.',
                  icon: 'search-outline',
                  actionLabel: 'Clear filters',
                  onAction: screen.clearFilters,
                }
              : {
                  title: 'No staff yet',
                  message: 'Add the people who use this POS, and give each one a role.',
                  icon: 'people-outline',
                  actionLabel: 'New staff',
                  onAction: openNewStaff,
                }
          }
          testID="staff-grid"
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
