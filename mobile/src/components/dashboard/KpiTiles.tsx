import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { colors, iconSizes, radius, spacing, typography } from '@/constants/theme';
import type { KpiTile } from '@/hooks/dashboard/dashboardModel';

type KpiTilesProps = {
  tiles: readonly KpiTile[];
  /** Tiles per row from `useResponsive().kpiColumns` (fewer when there are fewer tiles). */
  columns: number;
  gutter: number;
};

/** The soft icon tile: 32 dp, radius 10. */
const ICON_TILE = iconSizes.xl;

/**
 * A KPI card (Sage "Dashboard"): the label and a soft green icon tile on
 * top, the value (26 / 800, tabular), then the muted detail line. Not a chart.
 */
const StatTile = memo(function StatTile({ tile }: { tile: KpiTile }) {
  return (
    <Card style={styles.tile} testID={`kpi-${tile.key}`}>
      <View style={styles.top} accessible accessibilityLabel={`${tile.label}: ${tile.value}, ${tile.detail}`}>
        <Text style={styles.label} numberOfLines={2}>
          {tile.label}
        </Text>
        <View style={styles.icon}>
          <Icon name={tile.icon} size={iconSizes.sm} color={colors.primary} />
        </View>
      </View>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit testID={`kpi-${tile.key}-value`}>
        {tile.value}
      </Text>
      <Text style={styles.detail} numberOfLines={2} testID={`kpi-${tile.key}-detail`}>
        {tile.detail}
      </Text>
    </Card>
  );
});

/** The KPI row: 2 per row on phone portrait, 3 on phone landscape / tablet portrait, 5 on tablet landscape. */
export const KpiTiles = memo(function KpiTiles({ tiles, columns, gutter }: KpiTilesProps) {
  const cells = useMemo(() => tiles.map((tile) => ({ key: tile.key, node: <StatTile tile={tile} /> })), [tiles]);
  if (tiles.length === 0) return null;
  return <DashboardGrid cells={cells} columns={Math.min(columns, tiles.length)} gutter={gutter} testID="kpi-tiles" />;
});

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    gap: spacing.sm,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    flex: 1,
  },
  icon: {
    width: ICON_TILE,
    height: ICON_TILE,
    borderRadius: radius.inner,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    ...typography.kpiValue,
    color: colors.text,
  },
  detail: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
});
