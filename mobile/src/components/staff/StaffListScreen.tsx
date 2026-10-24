import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StaffCard } from '@/components/staff/StaffCard';
import { CardGrid, type GridTable } from '@/components/shared/CardGrid';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { Chip } from '@/components/ui/Chip';
import { CellText } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { Screen } from '@/components/ui/Screen';
import { ROUTES, staffRoute } from '@/constants/routes';
import { colors, iconSizes, spacing } from '@/constants/theme';
import type { StaffStatusFilter } from '@/hooks/staff/queryKeys';
import { useStaffListScreen } from '@/hooks/staff/useStaffListScreen';
import type { StaffUser } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatLastLogin } from '@/utils/dates';

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

function rowTestID(user: StaffUser): string {
  return `staff-card-${user.id}`;
}

/**
 * The table (tablets in landscape): name (You) and email, role, status, PIN,
 * last login, and the edit / view-only mark. Test IDs match the card's.
 */
function useStaffTable(selfId: number | null): GridTable<StaffUser> {
  return useMemo(
    () => ({
      columns: [
        {
          key: 'name',
          header: 'Name',
          flex: 1.8,
          render: (user) => (
            <View style={styles.cellStack}>
              <View style={styles.cellRow}>
                <CellText variant="strong">{user.name}</CellText>
                {user.id === selfId ? <Chip label="You" variant="primary" testID={`${rowTestID(user)}-you`} /> : null}
              </View>
              <CellText variant="muted">{user.email}</CellText>
            </View>
          ),
        },
        { key: 'role', header: 'Role', render: (user) => <Chip label={user.role.name} variant="primary" testID={`${rowTestID(user)}-role`} /> },
        {
          key: 'status',
          header: 'Status',
          flex: 0.8,
          render: (user) => (
            <Chip label={user.is_active ? 'Active' : 'Inactive'} variant={user.is_active ? 'completed' : 'neutral'} testID={`${rowTestID(user)}-status`} />
          ),
        },
        {
          key: 'pin',
          header: 'PIN',
          flex: 0.8,
          render: (user) => (
            <Chip label={user.has_pin ? 'PIN set' : 'No PIN'} variant={user.has_pin ? 'neutral' : 'caution'} testID={`${rowTestID(user)}-pin`} />
          ),
        },
        {
          key: 'login',
          header: 'Last login',
          render: (user) => <CellText testID={`${rowTestID(user)}-last-login`}>Last login: {formatLastLogin(user.last_login_at)}</CellText>,
        },
        {
          key: 'mark',
          header: '',
          width: iconSizes.xl,
          render: (user) =>
            user.can_manage ? (
              <View testID={`${rowTestID(user)}-edit`}>
                <Icon name="create-outline" size={iconSizes.md} color={colors.green} />
              </View>
            ) : (
              <View testID={`${rowTestID(user)}-locked`}>
                <Icon name="lock-closed" size={iconSizes.md} color={colors.textSecondary} />
              </View>
            ),
        },
      ],
      onRowPress: openStaff,
      rowAccessibilityLabel: (user) =>
        [
          user.name,
          user.id === selfId ? 'you' : null,
          user.role.name,
          user.is_active ? 'active' : 'inactive',
          user.has_pin ? 'PIN set' : 'no PIN',
          `last login ${formatLastLogin(user.last_login_at)}`,
          user.can_manage ? null : 'view only',
        ]
          .filter(Boolean)
          .join(', '),
      rowAccessibilityHint: (user) => (user.can_manage ? 'Opens the staff member to edit' : 'Opens the staff member, view only'),
      rowTestID,
    }),
    [selfId],
  );
}

/**
 * Staff list (permission `user.manage`).
 * - Header: back, "Staff", "+" (new staff).
 * - Filters above the list (so they survive loading/empty states and
 *   rotation): search (300 ms debounce), Active / Inactive / All, role chips.
 * - MASTER §6: the band (with the Add pill), the filters in a white card, then
 *   the table on tablets in landscape and the cards in portrait and on phones;
 *   "Showing n" and Load more, infinite scroll, pull-to-refresh, loading /
 *   empty / error-with-retry (a 403 shows "No access").
 */
export function StaffListScreen() {
  const screen = useStaffListScreen();
  const selfId = useSessionStore((state) => state.user?.id ?? null);
  const table = useStaffTable(selfId);
  const roleChips = useMemo(() => screen.roles.map((role) => ({ id: role.id, label: role.name })), [screen.roles]);

  return (
    <Screen edges={[]} testID="staff-list-screen">
      <ListHeader band title="Staff" newLabel="New staff" onNew={openNewStaff} testIDPrefix="staff" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="staff-toolbar">
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
        </ListToolbar>
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
          table={table}
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
  cellStack: {
    gap: spacing.xxs,
    maxWidth: '100%',
  },
  cellRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
