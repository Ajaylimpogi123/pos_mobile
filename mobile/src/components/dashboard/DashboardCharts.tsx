import { memo, useCallback, useMemo } from 'react';

import { DonutChart } from '@/components/charts/DonutChart';
import { HorizontalBarChart } from '@/components/charts/HorizontalBarChart';
import { LineChart } from '@/components/charts/LineChart';
import { SectionCard } from '@/components/dashboard/SectionCard';
import {
  activityChart,
  marginByCategoryChart,
  productsByCategoryChart,
  staffByRoleChart,
} from '@/hooks/dashboard/dashboardModel';
import type { ChartKey } from '@/hooks/dashboard/useDashboardScreen';
import type { DashboardActivity, DashboardCatalog, DashboardStaff } from '@/services/types';

/**
 * Chart cards take their `ChartKey` and a stable `onToggleTable(key)`, so a
 * card only re-renders when its own data or table state changes; the derived
 * chart models are memoised on the section they come from.
 */
export type ChartCardProps = { showTable: boolean; onToggleTable: (key: ChartKey) => void };

function useToggle(key: ChartKey, onToggleTable: (key: ChartKey) => void) {
  return useCallback(() => onToggleTable(key), [key, onToggleTable]);
}

/** Products by category: stacked Available / Unavailable bars. */
export const ProductsByCategoryCard = memo(function ProductsByCategoryCard({
  catalog,
  showTable,
  onToggleTable,
}: { catalog: DashboardCatalog } & ChartCardProps) {
  const model = useMemo(() => productsByCategoryChart(catalog), [catalog]);
  const onToggle = useToggle('productsByCategory', onToggleTable);
  return (
    <SectionCard
      title="Products by category"
      subtitle={`${catalog.products_available} of ${catalog.products_total} available`}
      tableToggle={{ showTable, onToggle }}
      testID="chart-card-products"
    >
      <HorizontalBarChart
        series={model.series}
        rows={model.rows}
        domain={model.domain}
        accessibilityLabel={model.accessibilityLabel}
        showTable={showTable}
        table={model.table}
        testID="chart-products"
      />
    </SectionCard>
  );
});

/** Average margin by category, with the target reference line. */
export const MarginByCategoryCard = memo(function MarginByCategoryCard({
  catalog,
  showTable,
  onToggleTable,
}: { catalog: DashboardCatalog } & ChartCardProps) {
  const model = useMemo(() => marginByCategoryChart(catalog), [catalog]);
  const onToggle = useToggle('marginByCategory', onToggleTable);
  return (
    <SectionCard
      title="Average margin by category"
      subtitle="Products with a price and a cost"
      tableToggle={{ showTable, onToggle }}
      testID="chart-card-margin"
    >
      <HorizontalBarChart
        series={model.series}
        rows={model.rows}
        domain={model.domain}
        reference={model.reference}
        noDataLabel="No cost data"
        accessibilityLabel={model.accessibilityLabel}
        showTable={showTable}
        table={model.table}
        testID="chart-margin"
      />
    </SectionCard>
  );
});

/** Staff by role: a donut with the total in the centre and counts in the legend. */
export const StaffByRoleCard = memo(function StaffByRoleCard({ staff, showTable, onToggleTable }: { staff: DashboardStaff } & ChartCardProps) {
  const model = useMemo(() => staffByRoleChart(staff), [staff]);
  const onToggle = useToggle('staffByRole', onToggleTable);
  return (
    <SectionCard
      title="Staff by role"
      subtitle={`${staff.active} active · ${staff.inactive} inactive`}
      tableToggle={{ showTable, onToggle }}
      testID="chart-card-staff"
    >
      <DonutChart
        data={model.data}
        centerLabel="staff"
        accessibilityLabel={model.accessibilityLabel}
        showTable={showTable}
        table={model.table}
        testID="chart-staff"
      />
    </SectionCard>
  );
});

/** Activity over the last 7 business days: logins and changes (menu, staff and customer edits) on one y-axis. */
export const ActivityCard = memo(function ActivityCard({
  activity,
  showTable,
  onToggleTable,
}: { activity: DashboardActivity } & ChartCardProps) {
  const model = useMemo(() => activityChart(activity), [activity]);
  const onToggle = useToggle('activity', onToggleTable);
  return (
    <SectionCard
      title="Activity, last 7 days"
      subtitle="Logins and changes per business day"
      tableToggle={{ showTable, onToggle }}
      testID="chart-card-activity"
    >
      <LineChart
        series={model.series}
        xLabels={model.xLabels}
        columnTitles={model.columnTitles}
        accessibilityLabel={model.accessibilityLabel}
        showTable={showTable}
        table={model.table}
        testID="chart-activity"
      />
    </SectionCard>
  );
});
