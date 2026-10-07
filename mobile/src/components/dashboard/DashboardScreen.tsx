import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ActivityCard,
  MarginByCategoryCard,
  ProductsByCategoryCard,
  StaffByRoleCard,
} from '@/components/dashboard/DashboardCharts';
import { DashboardGrid, type GridCell } from '@/components/dashboard/DashboardGrid';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { LowMarginList, RecentChangesList, RecentLoginsList } from '@/components/dashboard/DashboardLists';
import { InsightsCard } from '@/components/dashboard/InsightsCard';
import { KpiTiles } from '@/components/dashboard/KpiTiles';
import { SalesCard } from '@/components/dashboard/SalesCard';
import { PaymentMethodsCard, SalesTrendCard, TopProductsList } from '@/components/dashboard/SalesCharts';
import { Banner } from '@/components/ui/Banner';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/constants/theme';
import { hasSalesInLast7Days, kpiTiles } from '@/hooks/dashboard/dashboardModel';
import { useDashboardScreen } from '@/hooks/dashboard/useDashboardScreen';
import { getErrorMessage, isApiError } from '@/services/api';
import type { Dashboard } from '@/services/types';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/**
 * The dashboard: the main content area of the app shell. It shows only real
 * figures from GET /api/v1/dashboard; a section the user may not see is `null`
 * and is simply not rendered (no empty gaps). `sales` (with `report.view`)
 * leads with today's sales, or an honest "No sales yet today".
 * - The compact top bar (name, business date, branch, updated time), then the KPI tiles (2 / 3 / 3 / 5 per row), then a grid of
 *   section cards (1 column on phone portrait, 2 on phone landscape and tablet
 *   portrait, 2–3 on tablet landscape depending on the sidebar), all within
 *   the content max width.
 * - Pull-to-refresh, a refetch on focus, a loading state, and an error state
 *   with Retry (a failed refresh keeps the figures and shows a banner).
 * - Rotation only changes widths: every card keeps its place in the tree.
 */
export function DashboardScreen() {
  const screen = useDashboardScreen();
  const insets = useSafeAreaInsets();
  const { query, user, responsive, columns, tables, toggleTable } = screen;
  const { screenPaddingX, screenPaddingY, gutter, contentMaxWidth, kpiColumns } = responsive;
  const data = query.data;
  const tiles = useMemo(() => (data ? kpiTiles(data) : []), [data]);

  if (!user) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  const now = query.dataUpdatedAt || screen.openedAt;
  const header = (
    <DashboardHeader
      user={user}
      businessDate={data?.business_date ?? null}
      generatedAt={data?.generated_at ?? null}
      hour={new Date(now).getHours()}
    />
  );
  const offline = screen.isOffline ? (
    <Banner
      variant="warning"
      message="Offline: showing your saved session. Some details may be out of date."
      testID="offline-banner"
    />
  ) : null;
  const pagePadding = { paddingHorizontal: screenPaddingX, paddingTop: screenPaddingY };
  const refreshControl = (
    <RefreshControl
      refreshing={screen.refreshing}
      onRefresh={() => void screen.refresh()}
      colors={[colors.primaryBright]}
      tintColor={colors.primaryBright}
    />
  );

  if (!data) {
    const forbidden = isApiError(query.error) && query.error.status === 403;
    return (
      <Screen edges={[]} testID="dashboard-screen">
        {header}
        <SafeAreaView edges={['left', 'right']} style={styles.body}>
          {offline ? <View style={[styles.page, pagePadding, { maxWidth: contentMaxWidth }]}>{offline}</View> : null}
          {query.error ? (
            <ErrorState
              title={forbidden ? 'No access' : "Couldn't load the dashboard"}
              icon={forbidden ? 'lock-closed-outline' : 'cloud-offline-outline'}
              message={getErrorMessage(query.error)}
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
              refreshControl={refreshControl}
              testID="dashboard-error"
            />
          ) : (
            <LoadingState message="Loading the dashboard…" testID="dashboard-loading" />
          )}
        </SafeAreaView>
      </Screen>
    );
  }

  const cells = sectionCells(data, {
    now,
    canEditProducts: hasPermission(user, PERMISSIONS.productManage),
    user,
    tables,
    toggleTable,
    wide: columns === 3 ? 2 : 1,
  });

  return (
    <Screen edges={[]} testID="dashboard-screen">
      {header}
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.page,
            pagePadding,
            { maxWidth: contentMaxWidth, gap: gutter, paddingBottom: insets.bottom + screenPaddingY },
          ]}
          testID="dashboard-scroll"
        >
          {offline}
          {query.error ? (
            <Banner message={`Couldn't refresh: ${getErrorMessage(query.error)}`} testID="dashboard-refresh-error" />
          ) : null}
          <KpiTiles tiles={tiles} columns={kpiColumns} gutter={gutter} />
          <DashboardGrid cells={cells} columns={columns} gutter={gutter} testID="dashboard-grid" />
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

type CellOptions = {
  now: number;
  canEditProducts: boolean;
  user: ReturnType<typeof useDashboardScreen>['user'];
  tables: ReturnType<typeof useDashboardScreen>['tables'];
  toggleTable: ReturnType<typeof useDashboardScreen>['toggleTable'];
  /** The span of the wide cards (Sales, the sales trend, activity): 2 of 3 columns, as in the Sage board; else 1. */
  wide: number;
};

/** The section cards, in reading order; `null` sections contribute nothing. */
function sectionCells(data: Dashboard, { now, canEditProducts, user, tables, toggleTable, wide }: CellOptions): GridCell[] {
  const cells: GridCell[] = [];
  const { catalog, staff, activity, sales } = data;

  // Real sales only: today's card (or "No sales yet today"); the charts and the list only when there is data.
  if (sales) cells.push({ key: 'sales', span: wide, node: <SalesCard sales={sales} /> });
  cells.push({ key: 'insights', node: <InsightsCard insights={data.insights} user={user} /> });
  if (sales && hasSalesInLast7Days(sales)) {
    cells.push({
      key: 'sales-trend',
      span: wide,
      node: <SalesTrendCard sales={sales} showTable={tables.has('salesTrend')} onToggleTable={toggleTable} />,
    });
  }
  if (sales && sales.orders_count > 0) {
    cells.push({
      key: 'payments',
      node: (
        <PaymentMethodsCard
          sales={sales}
          showTable={tables.has('paymentMethods')}
          onToggleTable={toggleTable}
        />
      ),
    });
    if (sales.top_products.length > 0) cells.push({ key: 'top-products', node: <TopProductsList sales={sales} /> });
  }

  if (catalog) {
    cells.push({
      key: 'products',
      node: (
        <ProductsByCategoryCard
          catalog={catalog}
          showTable={tables.has('productsByCategory')}
          onToggleTable={toggleTable}
        />
      ),
    });
    cells.push({
      key: 'margin',
      node: (
        <MarginByCategoryCard
          catalog={catalog}
          showTable={tables.has('marginByCategory')}
          onToggleTable={toggleTable}
        />
      ),
    });
  }
  if (activity) {
    cells.push({
      key: 'activity',
      span: wide,
      node: <ActivityCard activity={activity} showTable={tables.has('activity')} onToggleTable={toggleTable} />,
    });
  }
  if (staff) {
    cells.push({
      key: 'staff',
      node: (
        <StaffByRoleCard staff={staff} showTable={tables.has('staffByRole')} onToggleTable={toggleTable} />
      ),
    });
  }
  if (catalog) {
    cells.push({
      key: 'low-margins',
      node: (
        <LowMarginList
          products={catalog.low_margin_products}
          thresholdBps={catalog.low_margin_threshold_bps}
          canEdit={canEditProducts}
        />
      ),
    });
  }
  if (activity) {
    cells.push({ key: 'recent-changes', node: <RecentChangesList changes={activity.recent_changes} now={now} /> });
  }
  if (staff) {
    cells.push({ key: 'recent-logins', node: <RecentLoginsList logins={staff.recent_logins} now={now} /> });
  }
  return cells;
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  page: {
    width: '100%',
    alignSelf: 'center',
  },
});
