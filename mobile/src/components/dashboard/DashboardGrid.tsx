import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

export type GridCell = {
  key: string;
  node: ReactNode;
  /** Columns this cell spans (capped at the column count). */
  span?: number;
};

type DashboardGridProps = {
  cells: readonly GridCell[];
  columns: number;
  gutter: number;
  testID?: string;
};

/**
 * A wrapping grid of equal-width cells. Every cell keeps its key and its
 * place under one parent whatever the column count, so a rotation only
 * changes widths: nothing remounts, and charts keep their state. Cells in a
 * row stretch to the same height.
 */
export function DashboardGrid({ cells, columns, gutter, testID }: DashboardGridProps) {
  const half = gutter / 2;
  return (
    <View style={[styles.grid, { marginHorizontal: -half, rowGap: gutter }]} testID={testID}>
      {cells.map((cell) => {
        const span = Math.min(cell.span ?? 1, columns);
        const width = `${(span / columns) * 100}%` as const;
        return (
          <View key={cell.key} style={[styles.cell, { width, paddingHorizontal: half }]} testID={`${testID ?? 'grid'}-cell-${cell.key}`}>
            {cell.node}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
  },
  cell: {
    flexDirection: 'column',
  },
});
