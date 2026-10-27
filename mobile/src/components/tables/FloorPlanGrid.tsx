import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { colors, layout, radius, sizes, spacing } from '@/constants/theme';
import { FLOOR_GRID_COLS, FLOOR_GRID_ROWS } from '@pos/core/tables/floorPlan';
import type { TableShape } from '@/services/types';

/** The cell size (dp) for this much width: the plan scales to the screen, within the theme's min and max. */
export function floorCellSize(availableWidth: number): number {
  return Math.max(layout.floorCellMin, Math.min(layout.floorCellMax, Math.floor((availableWidth - 2 * sizes.borderWidth) / FLOOR_GRID_COLS)));
}

/** A table's box on the plan: its cells, inset a little so neighbours don't touch. */
export function floorBoxStyle(
  table: { pos_x: number | null; pos_y: number | null; width: number; height: number; shape: TableShape },
  cell: number,
): ViewStyle {
  const inset = spacing.xxs;
  const width = table.width * cell - 2 * inset;
  const height = table.height * cell - 2 * inset;
  return {
    position: 'absolute',
    left: (table.pos_x ?? 0) * cell + inset,
    top: (table.pos_y ?? 0) * cell + inset,
    width,
    height,
    borderRadius: table.shape === 'round' ? Math.min(width, height) / 2 : radius.md,
  };
}

type FloorPlanGridProps = {
  cell: number;
  /** The width the plan may use; wider plans scroll sideways. */
  availableWidth: number;
  children: ReactNode;
  /** Editor: a tap on an empty cell (whole cells). */
  onPressCell?: (x: number, y: number) => void;
  pressCellLabel?: string;
  testID?: string;
};

/**
 * One area's plan (Table Management §B): the 24 × 16 grid drawn with SVG
 * hairlines, and the tables (children) drawn over it at their cells.
 */
export function FloorPlanGrid({ cell, availableWidth, children, onPressCell, pressCellLabel, testID }: FloorPlanGridProps) {
  const width = cell * FLOOR_GRID_COLS;
  const height = cell * FLOOR_GRID_ROWS;
  const frame = 2 * sizes.borderWidth;
  const scroll = width + frame > availableWidth + 1;

  const canvas = (
    <View style={[styles.canvas, { width: width + frame, height: height + frame }]} testID={testID}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width={width} height={height}>
          {Array.from({ length: FLOOR_GRID_COLS - 1 }, (_unused, index) => (
            <Line
              key={`c${index}`}
              x1={(index + 1) * cell}
              y1={0}
              x2={(index + 1) * cell}
              y2={height}
              stroke={colors.border}
              strokeWidth={sizes.borderWidth}
            />
          ))}
          {Array.from({ length: FLOOR_GRID_ROWS - 1 }, (_unused, index) => (
            <Line
              key={`r${index}`}
              x1={0}
              y1={(index + 1) * cell}
              x2={width}
              y2={(index + 1) * cell}
              stroke={colors.border}
              strokeWidth={sizes.borderWidth}
            />
          ))}
        </Svg>
      </View>
      {onPressCell ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel={pressCellLabel}
          onPress={(event) => onPressCell(Math.floor(event.nativeEvent.locationX / cell), Math.floor(event.nativeEvent.locationY / cell))}
          testID={testID ? `${testID}-cells` : undefined}
        />
      ) : null}
      {children}
    </View>
  );

  if (!scroll) return canvas;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}>
      {canvas}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  canvas: {
    alignSelf: 'flex-start',
    backgroundColor: colors.subtle,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  scroll: {
    paddingBottom: spacing.xs,
  },
});
