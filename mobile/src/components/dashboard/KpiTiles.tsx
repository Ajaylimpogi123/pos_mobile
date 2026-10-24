import { memo, useMemo } from 'react';

import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { StatCard } from '@/components/ui/StatCard';
import type { KpiTile } from '@/hooks/dashboard/dashboardModel';

type KpiTilesProps = {
  tiles: readonly KpiTile[];
  /** Tiles per row from `useResponsive().kpiColumns` (fewer when there are fewer tiles). */
  columns: number;
  gutter: number;
};

/**
 * The stat-card rows (back-office.md → Dashboard): Net sales (green), Orders
 * (blue), Average ticket (purple) and Low or out of stock (orange) first, then
 * the neutral overview figures. 2 per row on phone portrait, 3 on phone
 * landscape / tablet portrait, 5 on tablet landscape. Not a chart.
 */
export const KpiTiles = memo(function KpiTiles({ tiles, columns, gutter }: KpiTilesProps) {
  const cells = useMemo(
    () =>
      tiles.map((tile) => ({
        key: tile.key,
        node: (
          <StatCard
            label={tile.label}
            value={tile.value}
            icon={tile.icon}
            accent={tile.accent}
            footnote={tile.detail}
            testID={`kpi-${tile.key}`}
          />
        ),
      })),
    [tiles],
  );
  if (tiles.length === 0) return null;
  return <DashboardGrid cells={cells} columns={Math.min(columns, tiles.length)} gutter={gutter} testID="kpi-tiles" />;
});
