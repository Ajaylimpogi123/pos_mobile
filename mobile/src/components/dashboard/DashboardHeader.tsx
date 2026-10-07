import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, Text } from 'react-native';

import { MenuButton } from '@/components/shell/MenuButton';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { TopBar } from '@/components/ui/TopBar';
import { ROUTES } from '@/constants/routes';
import { colors, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import type { AuthUser } from '@/services/types';
import { formatBusinessDate, formatClockTime } from '@/utils/dates';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

type DashboardHeaderProps = {
  user: AuthUser;
  /** From the response; absent while the first load runs. */
  businessDate: string | null;
  generatedAt: string | null;
  /** Local hour, for the greeting. */
  hour: number;
};

/** "Good morning" (before noon), "Good afternoon" (before 6 PM), else "Good evening". */
export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function openSell() {
  router.push(ROUTES.sell);
}

/**
 * The dashboard's top bar (Sage "Dashboard" board): ☰ (phone portrait), the
 * greeting with the user's name, and a **New sale** shortcut to Sell for
 * users who can sell (`sale.create`; an icon button on phone portrait). Just
 * below, one muted line: the business date · the branch · when the figures
 * were generated (it wraps on narrow screens).
 */
export const DashboardHeader = memo(function DashboardHeader({ user, businessDate, generatedAt, hour }: DashboardHeaderProps) {
  const { isPhone, isPortrait } = useResponsive();
  const updated = generatedAt ? formatClockTime(generatedAt) : null;
  const canSell = hasPermission(user, PERMISSIONS.saleCreate);
  const compact = isPhone && isPortrait;

  let newSale = null;
  if (canSell) {
    newSale = compact ? (
      <IconButton icon="add" variant="primary" accessibilityLabel="New sale" onPress={openSell} testID="dashboard-new-sale" />
    ) : (
      <Button title="New sale" leftIcon="add" onPress={openSell} testID="dashboard-new-sale" />
    );
  }

  return (
    <TopBar title={`${greetingFor(hour)}, ${user.name}`} left={<MenuButton />} right={newSale} testID="dashboard-header">
      <Text style={styles.meta} testID="dashboard-meta">
        {businessDate ? (
          <>
            <Text testID="dashboard-date">{formatBusinessDate(businessDate)}</Text>
            {' · '}
          </>
        ) : null}
        <Text testID="dashboard-branch">{user.branch.name}</Text>
        {updated ? (
          <>
            {' · '}
            <Text testID="dashboard-updated">{`Updated ${updated}`}</Text>
          </>
        ) : null}
      </Text>
    </TopBar>
  );
});

const styles = StyleSheet.create({
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
