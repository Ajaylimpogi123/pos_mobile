import { router } from 'expo-router';
import { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuButton } from '@/components/shell/MenuButton';
import { useShell } from '@/components/shell/ShellContext';
import { Button } from '@/components/ui/Button';
import { HeaderBand } from '@/components/ui/HeaderBand';
import { TopBar } from '@/components/ui/TopBar';
import { ROUTES } from '@/constants/routes';
import { colors, layout, spacing, typography } from '@/constants/theme';
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
  /** v1.28: the sales period filter, drawn in the band under the greeting (wraps on narrow screens). */
  filter?: ReactNode;
};

/** "Good morning" (before noon), "Good afternoon" (before 6 PM), else "Good evening". */
export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "Mia Manager" → "Mia". */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

function openSell() {
  router.push(ROUTES.sell);
}

/**
 * The dashboard's header (back-office.md → Dashboard): the 48 dp header
 * ("Dashboard" and the sync badge; ☰ on phone portrait), then the decorative
 * band carrying the greeting ("Good afternoon, Mia", 26 / 700, white), the
 * business date, the branch and when the figures were generated (white), and
 * the dark **New sale** button for users who can sell (`sale.create`). The
 * cards drawn after it overlap the band.
 */
export const DashboardHeader = memo(function DashboardHeader({ user, businessDate, generatedAt, hour, filter }: DashboardHeaderProps) {
  const { screenPaddingX, bandCompact } = useResponsive();
  const { navigation } = useShell();
  const updated = generatedAt ? formatClockTime(generatedAt) : null;
  const canSell = hasPermission(user, PERMISSIONS.saleCreate);
  const firstName = firstNameOf(user.name);
  const greeting = firstName ? `${greetingFor(hour)}, ${firstName}` : greetingFor(hour);

  return (
    <View testID="dashboard-header">
      <TopBar title="Dashboard" left={navigation === 'drawer' ? <MenuButton /> : undefined} testID="dashboard-topbar" />
      <SafeAreaView edges={['left', 'right']}>
        <View style={[styles.band, { paddingHorizontal: screenPaddingX }]} testID="dashboard-band">
          <HeaderBand style={styles.bandShape} testID="dashboard-band-gradient" />
          <View style={styles.bandRow}>
            <View style={styles.bandText}>
              <Text
                style={[bandCompact ? typography.bandTitleCompact : typography.bandTitle, styles.onBand]}
                numberOfLines={1}
                accessibilityRole="header"
                testID="dashboard-greeting"
              >
                {greeting}
              </Text>
              <Text style={[typography.bandSubtitle, styles.onBand]} numberOfLines={2} testID="dashboard-meta">
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
            </View>
            {canSell ? <Button title="New sale" leftIcon="add" variant="strong" onPress={openSell} testID="dashboard-new-sale" /> : null}
          </View>
          {filter ? <View style={styles.filter}>{filter}</View> : null}
        </View>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  band: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  /** Inset so the band's 6 px corners show. */
  bandShape: {
    left: spacing.sm,
    right: spacing.sm,
    top: spacing.sm,
  },
  bandRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  /** MASTER §6: capped at half the band, so white text stays on its dark side. */
  bandText: {
    flexShrink: 1,
    maxWidth: `${layout.bandTextMaxShare * 100}%`,
    gap: spacing.xxs,
  },
  filter: {
    marginTop: spacing.md,
  },
  onBand: {
    color: colors.onGradient,
  },
});
